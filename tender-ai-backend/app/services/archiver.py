# -*- coding: utf-8 -*-
"""附件歸檔 service：下載「投標須知」等附件 → 落地 ``data/downloads/`` → 回相對路徑。

由 enrich job 呼叫；輸入 ``detail_parser`` 解析出的 ``attachments``
(每筆 ``{filename, url}``),用後端既有受治理 PCC 連線下載每個檔案,落地到
``data/downloads/<source>/<case_pk>/<filename>``,回傳可寫入
``TenderSnapshot.storage_uri`` 的**相對路徑**(相對於後端 root)。

設計要點
--------
* **沿用既有連線**:預設用 ``_pcc_http.pcc_session`` + ``governed_get``(SkipSSLAdapter
  + 瀏覽器 UA + 逾時重試);不重寫已測連線邏輯。``session``/``getter`` 可注入以離線測試。
* **檔名決定**:優先 ``Content-Disposition`` 的 ``filename*``/``filename``;否則用附件標籤
  並依 ``Content-Type`` 補副檔名;一律消毒路徑分隔字元與控制字元。
* **idempotent**:以 sha256 比對——目標檔已存在且內容相同則跳過;同名但內容不同則加序號
  (``-1``、``-2`` …),不覆蓋既有檔。
* **防呆**:逐檔 try/except,單檔失敗不影響其餘;回傳結果含 ``error`` 供 job 記
  ``CrawlFailure``。
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Callable
from urllib.parse import unquote

from app.adapters._pcc_http import governed_get, pcc_session

# 後端 root：app/services/archiver.py → parents[2]
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_DOWNLOAD_ROOT = _BACKEND_ROOT / "data" / "downloads"

# Content-Type → 副檔名(僅補無副檔名時用)
_CT_EXT = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/zip": ".zip",
    "application/octet-stream": "",
}

_CD_FILENAME_STAR_RE = re.compile(r"filename\*\s*=\s*[^']*''([^;]+)", re.IGNORECASE)
_CD_FILENAME_RE = re.compile(r'filename\s*=\s*"?([^";]+)"?', re.IGNORECASE)
_UNSAFE_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _sanitize(name: str) -> str:
    """消毒檔名:NFKC、移除路徑分隔/控制字元、收斂空白、限長。"""
    name = unicodedata.normalize("NFKC", name).strip()
    name = _UNSAFE_RE.sub("_", name)
    name = re.sub(r"\s+", " ", name).strip(" .") or "attachment"
    return name[:120]


def _filename_from_response(resp, fallback_label: str) -> str:
    """由回應決定落地檔名:Content-Disposition 優先,否則標籤 + 依 Content-Type 補副檔名。"""
    cd = resp.headers.get("Content-Disposition", "") or ""
    m = _CD_FILENAME_STAR_RE.search(cd) or _CD_FILENAME_RE.search(cd)
    if m:
        return _sanitize(unquote(m.group(1)))
    name = _sanitize(fallback_label)
    if not Path(name).suffix:
        ct = (resp.headers.get("Content-Type", "") or "").split(";")[0].strip().lower()
        name += _CT_EXT.get(ct, "")
    return name


def _dedup_target(dir_path: Path, filename: str, digest: str) -> tuple[Path, bool]:
    """決定落地路徑:同名同雜湊→沿用(skip);同名異容→加序號;不存在→直接用。

    回傳 ``(target_path, already_exists_same)``。
    """
    target = dir_path / filename
    if not target.exists():
        return target, False
    if hashlib.sha256(target.read_bytes()).hexdigest() == digest:
        return target, True  # idempotent:內容相同,跳過寫入
    stem, suffix = target.stem, target.suffix
    for i in range(1, 1000):
        cand = dir_path / f"{stem}-{i}{suffix}"
        if not cand.exists():
            return cand, False
        if hashlib.sha256(cand.read_bytes()).hexdigest() == digest:
            return cand, True
    raise RuntimeError(f"序號用盡,無法落地 {filename}")


def archive_attachments(
    source_name: str,
    case_pk: str,
    attachments: list[dict],
    *,
    base_dir: Path | None = None,
    session=None,
    getter: Callable = governed_get,
) -> list[dict]:
    """下載並歸檔附件清單;回傳每筆結果(含 ``storage_uri`` 或 ``error``)。

    結果欄位:``url``、``filename``(落地檔名)、``storage_uri``(相對後端 root)、
    ``sha256``、``skipped``(idempotent 命中)、``error``(失敗訊息,成功為 None)。
    """
    if not attachments:
        return []
    root = base_dir or _DOWNLOAD_ROOT
    dir_path = root / _sanitize(source_name) / _sanitize(str(case_pk))
    sess = session or pcc_session()
    results: list[dict] = []
    for att in attachments:
        url = att.get("url", "")
        label = att.get("filename") or "attachment"
        rec: dict = {"url": url, "filename": None, "storage_uri": None,
                     "sha256": None, "skipped": False, "error": None}
        try:
            resp = getter(sess, url)
            content = resp.content
            if not content:
                raise ValueError("空回應內容")
            digest = hashlib.sha256(content).hexdigest()
            dir_path.mkdir(parents=True, exist_ok=True)
            filename = _filename_from_response(resp, label)
            target, exists_same = _dedup_target(dir_path, filename, digest)
            if not exists_same:
                target.write_bytes(content)
            rec["filename"] = target.name
            # 相對「下載根目錄」:<source>/<case_pk>/<filename>;解析 = 下載根 / storage_uri。
            # 與 base_dir 無關,prod/test 一致;之後上雲只需改寫落地 backend。
            rec["storage_uri"] = str(target.relative_to(root))
            rec["sha256"] = digest
            rec["skipped"] = exists_same
        except Exception as exc:  # noqa: BLE001 — 逐檔防呆,交 job 記 CrawlFailure
            rec["error"] = f"{type(exc).__name__}: {exc}"
        results.append(rec)
    return results
