# -*- coding: utf-8 -*-
"""SL4 知識庫 ingestion：讀取 knowledge/*.md → 切塊 → 嵌入 → 寫入 knowledge_chunks。

- 來源僅公開領域知識（承標分級／篩選／優先序／資料源／可行度方法），無個資。
- 切塊策略：以 Markdown 標題（## / ###）為界切段，每段為一個 chunk；保留最近的
  區段標題（heading）供來源卡顯示脈絡。過長段落再依字數軟切。
- 防禦性移除 email；jieba 離線斷詞存入 tokens 供關鍵字檢索。
- 冪等：每份文件（doc_id）入庫前先整批刪除舊 chunk，再寫入新切塊。
- 需本機 Ollama 在線且已 pull EMBED_MODEL；CI／測試不跑此 job（改 mock embedding）。

執行：
    uv run python -m app.jobs.ingest_knowledge                 # 讀 settings.knowledge_dir
    uv run python -m app.jobs.ingest_knowledge --dir knowledge  # 指定目錄
    uv run python -m app.jobs.ingest_knowledge --batch 32
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.knowledge import KnowledgeChunk
from app.services.embedding import embed_texts
from app.services.text_index import strip_emails, tokens_string

# 單一 chunk 的字數軟上限；超過則在段落內再切（保留語意完整、利於嵌入品質）
_CHUNK_CHAR_MAX = 600
# 標題行：# / ## / ### ...
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


@dataclass
class _Chunk:
    doc_id: str
    title: str
    heading: str | None
    chunk_index: int
    content: str


def _soft_split(text: str, limit: int = _CHUNK_CHAR_MAX) -> list[str]:
    """段落過長時依字數軟切（盡量在換行處），避免單一 chunk 過大。"""
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    parts: list[str] = []
    buf = ""
    for line in text.splitlines():
        if buf and len(buf) + len(line) + 1 > limit:
            parts.append(buf.strip())
            buf = line
        else:
            buf = f"{buf}\n{line}" if buf else line
    if buf.strip():
        parts.append(buf.strip())
    return parts


def parse_markdown(doc_id: str, raw: str) -> list[_Chunk]:
    """把一份 Markdown 切成 chunks：以標題為界，標題下的內文成段。

    - 文件標題 title = 第一個 H1（# ...）或 doc_id。
    - 每個段落帶最近的標題作為 heading（H1 視為文件標題、不當區段 heading）。
    """
    lines = raw.splitlines()
    title: str | None = None
    cur_heading: str | None = None
    buf: list[str] = []
    sections: list[tuple[str | None, str]] = []  # (heading, body)

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append((cur_heading, body))
        buf.clear()

    for line in lines:
        m = _HEADING_RE.match(line)
        if m:
            flush()
            level = len(m.group(1))
            text = m.group(2).strip()
            if level == 1 and title is None:
                title = text
                cur_heading = None
            else:
                cur_heading = text
        else:
            buf.append(line)
    flush()

    title = title or doc_id
    chunks: list[_Chunk] = []
    idx = 0
    for heading, body in sections:
        for piece in _soft_split(strip_emails(body)):
            chunks.append(
                _Chunk(
                    doc_id=doc_id,
                    title=title,
                    heading=heading,
                    chunk_index=idx,
                    content=piece,
                )
            )
            idx += 1
    return chunks


def _load_docs(knowledge_dir: Path) -> list[tuple[str, str]]:
    """讀取目錄下所有 *.md（排除底線開頭的非語料檔），回傳 (doc_id, raw)。"""
    docs: list[tuple[str, str]] = []
    for path in sorted(knowledge_dir.glob("*.md")):
        if path.name.startswith("_"):
            continue
        docs.append((path.stem, path.read_text(encoding="utf-8")))
    return docs


async def _replace_doc(session, doc_id: str, rows: list[dict]) -> None:
    """冪等：先刪該 doc 既有 chunks，再寫入新切塊。"""
    await session.execute(
        delete(KnowledgeChunk).where(KnowledgeChunk.doc_id == doc_id)
    )
    if rows:
        await session.execute(pg_insert(KnowledgeChunk).values(rows))


async def run_ingest(*, knowledge_dir: str | None = None, batch_size: int = 32) -> dict:
    model = settings.embed_model
    base = Path(knowledge_dir or settings.knowledge_dir)
    stats = {"model": model, "dir": str(base), "docs": 0, "chunks": 0}

    if not base.is_dir():
        raise FileNotFoundError(f"知識庫目錄不存在：{base.resolve()}")

    docs = _load_docs(base)
    async with AsyncSessionLocal() as session:
        for doc_id, raw in docs:
            chunks = parse_markdown(doc_id, raw)
            if not chunks:
                await _replace_doc(session, doc_id, [])
                await session.commit()
                continue

            rows: list[dict] = []
            for i in range(0, len(chunks), batch_size):
                part = chunks[i : i + batch_size]
                vectors = await embed_texts([c.content for c in part], model=model)
                for c, v in zip(part, vectors):
                    rows.append(
                        dict(
                            doc_id=c.doc_id,
                            title=c.title,
                            heading=c.heading,
                            chunk_index=c.chunk_index,
                            content=c.content,
                            tokens=tokens_string(c.content),
                            embedding=v,
                            model=model,
                        )
                    )
            await _replace_doc(session, doc_id, rows)
            await session.commit()
            stats["docs"] += 1
            stats["chunks"] += len(rows)
            print(
                f"  文件 {doc_id}：{len(rows)} 塊",
                file=sys.stderr,
            )

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="知識庫切塊嵌入（SL4 Layer A）")
    ap.add_argument("--dir", type=str, default=None, help="知識庫目錄（預設 settings.knowledge_dir）")
    ap.add_argument("--batch", type=int, default=32, help="嵌入批次大小（預設 32）")
    args = ap.parse_args()

    stats = asyncio.run(run_ingest(knowledge_dir=args.dir, batch_size=args.batch))
    print(
        f"知識庫嵌入完成：模型 {stats['model']}｜目錄 {stats['dir']}"
        f"｜文件 {stats['docs']}｜切塊 {stats['chunks']}"
    )


if __name__ == "__main__":
    main()
