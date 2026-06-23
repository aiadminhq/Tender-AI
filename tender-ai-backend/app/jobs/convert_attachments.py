# -*- coding: utf-8 -*-
"""PCC 詳情附件轉檔 pipeline:下載附件 → 依格式抽純文字,供 enrich/embedding 使用。

定位(方案 C「轉檔」)
--------------------
``detail_parser._parse_attachments`` 解出每筆 ``{filename, url}``;``archiver``
負責下載落地(``storage_uri``/``sha256``)。**本模組接力做「位元組 → 純文字」**:
依副檔名/Content-Type 路由到對應轉檔器(PDF/DOCX/ODT/ZIP/純文字),回傳每個附件的
``{filename, kind, text, char_count, error?}``,讓上層寫入 ``revision.attachments[*].text``
或另存供 embedding。

設計要點
--------
* **純函式為核心**:``convert_attachment_bytes(filename, content_type, data)`` 不連網、
  無副作用,直接餵 bytes 即可測試;``download_and_convert`` 才連網(重用受治理 HTTP)。
* **重型套件 lazy import**:PDF 解析(``pypdf`` 優先、``pdfminer.six`` 後備)只在真的遇到
  PDF 時 import;DOCX/ODT/ZIP 純以標準庫 ``zipfile`` + XML 解析,**零額外相依**,
  確保 CI / 離線可跑。
* **安全防線**:單檔大小上限(``MAX_BYTES``)、抽出文字上限(``MAX_TEXT_CHARS``)、
  ZIP 解壓總量/檔數/巢狀層數上限(zip-bomb 防護)、單檔失敗隔離(記 ``error``,
  不影響其他附件)。
* **下載一律走 ``_pcc_http.governed_get``**(SkipSSLAdapter + 瀏覽器 UA + 逾時重試),
  不自建 session 規避既有受治理連線。

Layer A:附件內容為公開招標文件,衍生純文字可重生,不含任何 Layer B 行為資料。

執行(本機手動;連網,勿在 CI 跑):
    uv run python -m app.jobs.convert_attachments --url <附件URL> [--filename a.pdf]
    uv run python -m app.jobs.convert_attachments --file path/to/local.docx
"""
from __future__ import annotations

import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import PurePosixPath
from typing import Callable

from app.adapters._pcc_http import governed_get, pcc_session

# --------------------------------------------------------------------------- #
# 安全上限(可由呼叫端覆寫)
# --------------------------------------------------------------------------- #
MAX_BYTES = 30 * 1024 * 1024            # 單一附件下載/處理大小上限:30 MiB
MAX_TEXT_CHARS = 2_000_000             # 單一附件抽出文字字數上限(防巨量純文字)
ZIP_MAX_TOTAL_BYTES = 200 * 1024 * 1024  # ZIP 解壓後總位元組上限(zip-bomb 防護)
ZIP_MAX_ENTRIES = 500                   # ZIP 內最多處理檔數
ZIP_MAX_DEPTH = 3                       # ZIP 巢狀遞迴最大層數

# 副檔名 → 種類(轉檔器路由的主要依據;Content-Type 為輔)
_EXT_KIND = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".odt": "odt",
    ".zip": "zip",
    ".txt": "text",
    ".csv": "text",
    ".md": "text",
}

# Content-Type → 種類(無可辨識副檔名時的後備路由)
_CT_KIND = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.oasis.opendocument.text": "odt",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "text/plain": "text",
    "text/csv": "text",
}

# Office Open XML / ODF 命名空間(只取需要的)
_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_ODF_TEXT_NS = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"


# --------------------------------------------------------------------------- #
# 工具
# --------------------------------------------------------------------------- #
def _nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def _clip(text: str, limit: int | None = None) -> str:
    """文字上限裁切(NFKC + 去尾空白);超限保留前 limit 字。

    ``limit`` 預設於呼叫時讀模組層 ``MAX_TEXT_CHARS``(而非綁定函式定義時的值),
    讓測試 monkeypatch ``MAX_TEXT_CHARS`` 能生效。
    """
    if limit is None:
        limit = MAX_TEXT_CHARS
    text = _nfkc(text)
    if len(text) > limit:
        text = text[:limit]
    return text.strip()


def detect_kind(filename: str | None, content_type: str | None) -> str:
    """依副檔名(優先)/Content-Type 判種類;皆無法辨識回 ``unknown``。"""
    suffix = PurePosixPath((filename or "").strip()).suffix.lower()
    if suffix in _EXT_KIND:
        return _EXT_KIND[suffix]
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _CT_KIND:
        return _CT_KIND[ct]
    # DOC(舊版二進位 OLE):無純標準庫可靠解析,標記為不支援,交呼叫端記 error。
    if suffix == ".doc" or ct == "application/msword":
        return "doc"
    return "unknown"


# --------------------------------------------------------------------------- #
# 各格式轉檔器(皆吃 bytes、回 str;失敗以例外上拋,由 dispatcher 收斂為 error)
# --------------------------------------------------------------------------- #
def extract_pdf(data: bytes) -> str:
    """PDF → 文字:``pypdf`` 優先,缺則退 ``pdfminer.six``;皆無則拋 ImportError。

    兩者皆 **lazy import**,測試離線時可不安裝(以 monkeypatch 替換本函式)。
    """
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except ImportError:
        pass
    try:
        from pdfminer.high_level import extract_text  # type: ignore

        return extract_text(io.BytesIO(data)) or ""
    except ImportError as exc:  # 兩條後備皆缺
        raise ImportError(
            "PDF 轉檔需要 pypdf 或 pdfminer.six,請安裝其一"
        ) from exc


def extract_docx(data: bytes) -> str:
    """DOCX → 文字:以標準庫 zipfile 解 ``word/document.xml``,串接 ``<w:t>`` 文字。

    不依賴 python-docx(零額外相依);段落(``<w:p>``)間以換行分隔。
    """
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        try:
            xml = zf.read("word/document.xml")
        except KeyError as exc:
            raise ValueError("DOCX 缺 word/document.xml") from exc
    root = ET.fromstring(xml)
    lines: list[str] = []
    for para in root.iter(f"{_W_NS}p"):
        texts = [node.text or "" for node in para.iter(f"{_W_NS}t")]
        line = "".join(texts).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def extract_doc(data: bytes) -> str:
    """舊版 ``.doc``(OLE 二進位)→ 文字。

    markitdown 與純標準庫皆**無法**解析舊版二進位 ``.doc``(只吃 ``.docx``)。本附件
    入庫 job 僅在本機 macOS 執行(需連 PCC 歸檔＋本機 Ollama),故改用 macOS 內建
    ``textutil``:走系統文字引擎,**本機處理、不下載、不外送任何 LLM**。
    非 macOS 或無 ``textutil`` 時拋錯,由 dispatcher 收斂為可記錄的 error。
    """
    if sys.platform != "darwin" or not shutil.which("textutil"):
        raise RuntimeError(
            "舊版 .doc 需 macOS 內建 textutil 解析(markitdown 不支援二進位 .doc);"
            "此環境無 textutil,略過"
        )
    with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        proc = subprocess.run(
            ["textutil", "-convert", "txt", "-encoding", "UTF-8", "-stdout", tmp_path],
            capture_output=True,
            timeout=60,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"textutil 轉檔失敗(rc={proc.returncode}):"
                f"{proc.stderr.decode('utf-8', 'replace').strip()}"
            )
        return proc.stdout.decode("utf-8", errors="replace")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def extract_odt(data: bytes) -> str:
    """ODT → 文字:以標準庫 zipfile 解 ``content.xml``,串接 text 命名空間下的文字。

    不依賴 odfpy(零額外相依);段落/標題(``text:p``/``text:h``)間以換行分隔。
    """
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        try:
            xml = zf.read("content.xml")
        except KeyError as exc:
            raise ValueError("ODT 缺 content.xml") from exc
    root = ET.fromstring(xml)
    lines: list[str] = []
    for tag in (f"{_ODF_TEXT_NS}p", f"{_ODF_TEXT_NS}h"):
        for node in root.iter(tag):
            # itertext 連同 <text:span> 等子元素的文字一併取出
            line = "".join(node.itertext()).strip()
            if line:
                lines.append(line)
    return "\n".join(lines)


def extract_text_plain(data: bytes) -> str:
    """純文字:嘗試 UTF-8 → Big5 → latin-1(最寬鬆,絕不失敗)解碼。"""
    for enc in ("utf-8", "big5", "cp950"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


# --------------------------------------------------------------------------- #
# ZIP:遞迴解內含檔(zip-bomb 防護)
# --------------------------------------------------------------------------- #
def _convert_zip(
    data: bytes,
    *,
    depth: int,
    budget: dict,
) -> list[dict]:
    """解開 ZIP,對每個內含檔遞迴呼叫 dispatcher;回傳子附件結果清單(攤平)。

    ``budget`` 為跨整個 ZIP 樹共享的限額(total_bytes / entries),防 zip-bomb。
    """
    out: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            if budget["entries"] <= 0:
                out.append({
                    "filename": info.filename, "kind": "unknown", "text": "",
                    "char_count": 0, "error": "ZIP 內檔數超過上限,略過",
                })
                break
            budget["entries"] -= 1
            # 解壓前先看宣告大小,超量直接拒(避免讀進記憶體)
            if info.file_size > budget["total_bytes"]:
                out.append({
                    "filename": info.filename, "kind": "unknown", "text": "",
                    "char_count": 0, "error": "ZIP 解壓總量超過上限,略過",
                })
                continue
            try:
                inner = zf.read(info)
            except Exception as exc:  # noqa: BLE001 — 單檔失敗隔離
                out.append({
                    "filename": info.filename, "kind": "unknown", "text": "",
                    "char_count": 0, "error": f"{type(exc).__name__}: {exc}",
                })
                continue
            budget["total_bytes"] -= len(inner)
            out.append(
                _convert_bytes_inner(info.filename, None, inner, depth=depth + 1, budget=budget)
            )
    return out


# --------------------------------------------------------------------------- #
# Dispatcher(純函式核心)
# --------------------------------------------------------------------------- #
def _convert_bytes_inner(
    filename: str | None,
    content_type: str | None,
    data: bytes,
    *,
    depth: int,
    budget: dict,
) -> dict:
    """內部 dispatcher:含 depth/budget 狀態的單檔轉換。

    回傳 ``{filename, kind, text, char_count, error}``;ZIP 命中時 ``text`` 為空、
    另帶 ``children``(攤平的子附件結果)。
    """
    rec: dict = {
        "filename": filename, "kind": None, "text": "",
        "char_count": 0, "error": None,
    }
    if data is None or len(data) == 0:
        rec["kind"] = "unknown"
        rec["error"] = "空內容"
        return rec
    if len(data) > MAX_BYTES:
        rec["kind"] = detect_kind(filename, content_type)
        rec["error"] = f"超過單檔大小上限 {MAX_BYTES} bytes(實際 {len(data)})"
        return rec

    kind = detect_kind(filename, content_type)
    rec["kind"] = kind
    try:
        if kind == "pdf":
            text = extract_pdf(data)
        elif kind == "docx":
            text = extract_docx(data)
        elif kind == "odt":
            text = extract_odt(data)
        elif kind == "text":
            text = extract_text_plain(data)
        elif kind == "zip":
            if depth >= ZIP_MAX_DEPTH:
                rec["error"] = f"ZIP 巢狀超過 {ZIP_MAX_DEPTH} 層,停止遞迴"
                return rec
            rec["children"] = _convert_zip(data, depth=depth, budget=budget)
            # 把子檔文字彙整到本層 text(方便上層直接用),仍保留 children 明細
            joined = "\n\n".join(
                c.get("text", "") for c in rec["children"] if c.get("text")
            )
            rec["text"] = _clip(joined)
            rec["char_count"] = len(rec["text"])
            return rec
        elif kind == "doc":
            text = extract_doc(data)
        else:
            rec["error"] = "無法辨識的附件格式,略過"
            return rec
    except Exception as exc:  # noqa: BLE001 — 單檔失敗隔離,記 error
        rec["error"] = f"{type(exc).__name__}: {exc}"
        return rec

    rec["text"] = _clip(text)
    rec["char_count"] = len(rec["text"])
    return rec


def convert_attachment_bytes(
    filename: str | None,
    content_type: str | None,
    data: bytes,
) -> dict:
    """**純函式**:給定附件位元組,依格式抽純文字。

    回傳 ``{filename, kind, text, char_count, error}``(ZIP 另含 ``children``)。
    不連網、無副作用,方便單元測試。
    """
    budget = {"total_bytes": ZIP_MAX_TOTAL_BYTES, "entries": ZIP_MAX_ENTRIES}
    return _convert_bytes_inner(filename, content_type, data, depth=0, budget=budget)


# --------------------------------------------------------------------------- #
# 下載 + 轉換(連網;重用受治理 HTTP)
# --------------------------------------------------------------------------- #
def download_and_convert(
    attachment: dict,
    *,
    session=None,
    getter: Callable = governed_get,
    max_bytes: int = MAX_BYTES,
) -> dict:
    """下載單一附件(``{filename, url}``)→ 轉純文字。

    下載走受治理 HTTP(``governed_get`` + ``pcc_session``);``session``/``getter``
    可注入以離線測試。回傳同 ``convert_attachment_bytes``,另帶 ``url``。
    """
    url = attachment.get("url", "")
    label = attachment.get("filename")
    rec: dict = {
        "url": url, "filename": label, "kind": None, "text": "",
        "char_count": 0, "error": None,
    }
    if not url:
        rec["error"] = "附件缺 url"
        return rec
    sess = session or pcc_session()
    try:
        resp = getter(sess, url)
        content = resp.content or b""
        if len(content) > max_bytes:
            rec["error"] = f"超過單檔大小上限 {max_bytes} bytes(實際 {len(content)})"
            return rec
        ct = (resp.headers.get("Content-Type") if hasattr(resp, "headers") else None)
    except Exception as exc:  # noqa: BLE001 — 下載失敗記 error,不中斷整批
        rec["error"] = f"{type(exc).__name__}: {exc}"
        return rec
    converted = convert_attachment_bytes(label, ct, content)
    converted["url"] = url
    return converted


def convert_attachments(
    attachments: list[dict],
    *,
    session=None,
    getter: Callable = governed_get,
) -> list[dict]:
    """整合函式:對一案的附件清單逐筆下載 + 轉換;單檔失敗隔離。

    ``attachments`` 為 ``detail_parser`` 產出的 ``[{filename, url}, ...]``(或 archiver
    結果)。回傳每筆轉換結果清單。
    """
    if not attachments:
        return []
    sess = session or pcc_session()
    return [
        download_and_convert(att, session=sess, getter=getter)
        for att in attachments
    ]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(
        description="PCC 詳情附件轉檔:下載/讀本地檔 → 抽純文字(連網需能連 PCC,勿在 CI 跑)"
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="附件 URL(走受治理 HTTP 下載)")
    src.add_argument("--file", help="本地檔路徑(離線測試轉檔器)")
    ap.add_argument("--filename", default=None, help="覆寫檔名(供副檔名路由;--file 時預設取路徑名)")
    ap.add_argument("--content-type", default=None, help="覆寫 Content-Type")
    ap.add_argument("--preview", type=int, default=500, help="輸出文字預覽字數(預設 500)")
    args = ap.parse_args()

    if args.file:
        from pathlib import Path

        path = Path(args.file)
        data = path.read_bytes()
        rec = convert_attachment_bytes(args.filename or path.name, args.content_type, data)
    else:
        rec = download_and_convert(
            {"url": args.url, "filename": args.filename or args.url.rsplit("/", 1)[-1]}
        )

    print(f"檔名:{rec.get('filename')}", file=sys.stderr)
    print(f"種類:{rec.get('kind')}｜字數:{rec.get('char_count')}", file=sys.stderr)
    if rec.get("error"):
        print(f"錯誤:{rec['error']}", file=sys.stderr)
    if rec.get("children"):
        print(f"ZIP 內含 {len(rec['children'])} 檔", file=sys.stderr)
    preview = (rec.get("text") or "")[: args.preview]
    print(preview)


if __name__ == "__main__":
    main()
