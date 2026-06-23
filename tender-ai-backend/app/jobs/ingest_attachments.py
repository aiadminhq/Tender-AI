# -*- coding: utf-8 -*-
"""階段三「歸檔入庫」：把已歸檔的招標附件（投標須知等）抽文字 → 切塊 → 嵌入 → 寫入
``knowledge_chunks``，讓附件內容進入共享知識庫供語意檢索／回答引用。

設計重點
--------
- **不重抓 PCC**：附件位元組一律從本機歸檔（``data/downloads/<source>/<case_pk>/...``，
  即 ``revision.attachments[].storage_uri``）讀取，零連網、不再撞驗證碼。
- **沿用既有純函式**：轉檔用 :func:`convert_attachment_bytes`（pdf/docx/odt/doc/zip，
  本機處理、不外送 LLM）；切塊／嵌入／冪等寫入完全沿用 ``ingest_knowledge`` 的
  ``_soft_split`` / ``embed_texts`` / ``_replace_doc``，不另立一套。
- **doc_id 規則**：每案一份文件 ``attach-PCC-<case_pk>``；該案多個附件依序串成 chunks
  （``heading`` = 附件原始檔名）。重跑冪等（先刪該 doc 既有 chunk 再寫）。
- **Layer 歸屬**：招標附件屬 **Layer A 公開標案資料**（可從原始來源重建），無個資；
  與 ``ingest_knowledge`` 同一張 ``knowledge_chunks``，前端仍只保留附件下載連結。

執行：
    uv run python -m app.jobs.ingest_attachments                 # 全部已歸檔附件
    uv run python -m app.jobs.ingest_attachments --case 71235010 # 僅指定案
    uv run python -m app.jobs.ingest_attachments --limit 20 --batch 32

**絕不在 CI/pytest 跑**：需本機 Ollama 在線且已 pull EMBED_MODEL；測試改 mock embedding。
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from email.header import decode_header, make_header

from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.jobs.convert_attachments import convert_attachment_bytes
from app.jobs.ingest_knowledge import _replace_doc, _soft_split
from app.models.revision import TenderRevision
from app.models.tender import Tender
from app.services.archiver import _DOWNLOAD_ROOT
from app.services.embedding import embed_texts
from app.services.text_index import strip_emails, tokens_string

# 歸檔檔名為 RFC2047 但把 `?` 改成 `_` 以利落地：=_<charset>_<B|Q>_<payload>_=
_MIME_NAME_RE = re.compile(r"^=_([\w-]+)_([BQbq])_(.*)_=$")


def _decode_mime_name(name: str | None) -> str:
    """還原歸檔檔名（RFC2047 變體）為可讀檔名；無法解則原樣回傳。

    僅用於判斷副檔名（決定轉檔器）與當作 chunk 的 ``heading``。
    """
    if not name:
        return name or ""
    m = _MIME_NAME_RE.match(name)
    if not m:
        return name
    charset, enc, payload = m.groups()
    try:
        return str(make_header(decode_header(f"=?{charset}?{enc}?{payload}?=")))
    except Exception:  # noqa: BLE001 — 解碼失敗不致命，退回原名
        return name


def _sniff_content_type(data: bytes) -> str | None:
    """以檔頭 magic bytes 補判型別，供轉檔器在檔名副檔名無法辨識時路由。

    PCC 歸檔檔名是 RFC2047 多詞編碼，偶有無法還原副檔名的情況；改看內容檔頭最穩。
    回傳對應 :data:`convert_attachments._CT_KIND` 的 Content-Type，無法判斷回 ``None``。
    """
    head = data[:8]
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head.startswith(b"PK\x03\x04"):
        # OOXML / ODF 皆為 zip；ODT 首個成員為未壓縮的 `mimetype`，據此區分 docx/odt。
        window = data[:2048]
        if b"opendocument.text" in window:
            return "application/vnd.oasis.opendocument.text"
        if b"word/" in window or b"[Content_Types].xml" in window:
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return "application/zip"
    # 舊版 .doc（OLE 二進位 \xd0\xcf\x11\xe0）目前無純標準庫解析，留給轉檔器記 error。
    return None


def _doc_id(case_pk: str) -> str:
    return f"attach-PCC-{case_pk}"


async def run_ingest_attachments(
    *,
    case_pk: str | None = None,
    limit: int | None = None,
    batch_size: int = 32,
) -> dict:
    """讀已歸檔附件 → 轉文字 → 切塊嵌入 → 冪等寫入 knowledge_chunks。

    走每案 **current revision** 的 ``attachments``（去重、避免新舊版重複入庫）。
    """
    model = settings.embed_model
    stats = {
        "model": model,
        "tenders": 0,        # 有附件可處理的案數
        "ingested_docs": 0,  # 實際入庫文件數
        "attachments": 0,    # 成功轉文字的附件數
        "chunks": 0,
        "skipped": 0,        # 缺檔/轉檔失敗/空文字
    }

    async with AsyncSessionLocal() as session:
        # current_revision 僅有 FK 欄位、無 relationship；以 join 取現值 revision。
        stmt = (
            select(Tender, TenderRevision)
            .join(TenderRevision, TenderRevision.id == Tender.current_revision_id)
            .where(Tender.current_revision_id.isnot(None))
            .order_by(Tender.id)
        )
        if case_pk:
            stmt = stmt.where(Tender.case_pk == case_pk)
        if limit:
            stmt = stmt.limit(limit)

        for tender, rev in (await session.execute(stmt)).all():
            attachments = (rev.attachments if rev else None) or []
            # 注意：``skipped=True`` 僅代表歸檔時去重（檔已在磁碟），仍可用；
            # 真正不可用的是缺 storage_uri 或下載 error，實體是否存在由磁碟檢查把關。
            usable = [
                a for a in attachments
                if a.get("storage_uri") and not a.get("error")
            ]
            if not usable:
                continue
            stats["tenders"] += 1

            doc_id = _doc_id(tender.case_pk)
            title = " ／ ".join(x for x in (tender.org, tender.name) if x) or doc_id

            pieces: list[tuple[str, str]] = []  # (heading, content)
            for att in usable:
                path = (_DOWNLOAD_ROOT / att["storage_uri"]).resolve()
                if not path.is_file():
                    stats["skipped"] += 1
                    print(f"  ⚠ {tender.case_pk} 缺檔：{att['storage_uri']}", file=sys.stderr)
                    continue
                display_name = _decode_mime_name(att.get("filename"))
                data = path.read_bytes()
                conv = convert_attachment_bytes(display_name, _sniff_content_type(data), data)
                text = (conv.get("text") or "").strip()
                if conv.get("error") or not text:
                    stats["skipped"] += 1
                    print(
                        f"  ⚠ {tender.case_pk} 轉檔無文字：{display_name}"
                        f"（{conv.get('error') or '空白'}）",
                        file=sys.stderr,
                    )
                    continue
                stats["attachments"] += 1
                for seg in _soft_split(strip_emails(text)):
                    pieces.append((display_name, seg))

            if not pieces:
                # 該案無可用文字：冪等清掉舊 chunk（若曾入庫過）後跳過
                await _replace_doc(session, doc_id, [])
                await session.commit()
                continue

            rows: list[dict] = []
            for i in range(0, len(pieces), batch_size):
                part = pieces[i : i + batch_size]
                vectors = await embed_texts([c for _, c in part], model=model)
                for (heading, content), v in zip(part, vectors):
                    rows.append(
                        dict(
                            doc_id=doc_id,
                            title=title,
                            heading=heading,
                            chunk_index=len(rows),
                            content=content,
                            tokens=tokens_string(content),
                            embedding=v,
                            model=model,
                        )
                    )
            await _replace_doc(session, doc_id, rows)
            await session.commit()
            stats["ingested_docs"] += 1
            stats["chunks"] += len(rows)
            print(f"  文件 {doc_id}（{title}）：{len(rows)} 塊", file=sys.stderr)

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="附件歸檔入庫（Layer A 公開附件 → knowledge_chunks）")
    ap.add_argument("--case", type=str, default=None, help="僅處理指定 case_pk")
    ap.add_argument("--limit", type=int, default=None, help="最多處理幾個案（預設全部）")
    ap.add_argument("--batch", type=int, default=32, help="嵌入批次大小（預設 32）")
    args = ap.parse_args()

    stats = asyncio.run(
        run_ingest_attachments(case_pk=args.case, limit=args.limit, batch_size=args.batch)
    )
    print(
        f"附件入庫完成：模型 {stats['model']}｜有附件案 {stats['tenders']}"
        f"｜入庫文件 {stats['ingested_docs']}｜附件 {stats['attachments']}"
        f"｜切塊 {stats['chunks']}｜略過 {stats['skipped']}"
    )


if __name__ == "__main__":
    main()
