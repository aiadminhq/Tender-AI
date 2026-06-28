# -*- coding: utf-8 -*-
"""附件轉檔 pipeline 的離線測試(不連網)。

涵蓋:
- 格式路由(副檔名 / Content-Type / 不可辨識 / 舊版 .doc 不支援)
- DOCX / ODT / ZIP 以標準庫自製最小檔的文字抽取(零外部相依)
- PDF 以 monkeypatch 替換轉檔器(離線不需安裝 pypdf/pdfminer)
- 純文字編碼後備、空內容、單檔大小上限
- ZIP 遞迴解、zip-bomb 上限(檔數 / 總量)、巢狀層數上限、單檔失敗隔離
- download_and_convert 以假 getter 注入回應(下載部分 monkeypatch)
"""
from __future__ import annotations

import io
import zipfile

import pytest

from app.jobs import convert_attachments as ca

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_ODF_TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"


# --------------------------------------------------------------------------- #
# 自製最小測試檔(純標準庫,不連網)
# --------------------------------------------------------------------------- #
def _make_docx(paragraphs: list[str]) -> bytes:
    ps = "".join(
        f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paragraphs
    )
    document = (
        f'<?xml version="1.0"?>'
        f'<w:document xmlns:w="{_W_NS}"><w:body>{ps}</w:body></w:document>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", document)
    return buf.getvalue()


def _make_odt(paragraphs: list[str]) -> bytes:
    ps = "".join(f'<text:p>{p}</text:p>' for p in paragraphs)
    content = (
        f'<?xml version="1.0"?>'
        f'<office:document-content xmlns:text="{_ODF_TEXT}" '
        f'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0">'
        f'<office:body><office:text>{ps}</office:text></office:body>'
        f'</office:document-content>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("content.xml", content)
    return buf.getvalue()


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, payload in entries.items():
            zf.writestr(name, payload)
    return buf.getvalue()


class _Resp:
    def __init__(self, content: bytes, headers: dict | None = None):
        self.content = content
        self.headers = headers or {}


# --------------------------------------------------------------------------- #
# 格式路由
# --------------------------------------------------------------------------- #
def test_detect_kind_by_extension():
    assert ca.detect_kind("須知.pdf", None) == "pdf"
    assert ca.detect_kind("a.DOCX", None) == "docx"
    assert ca.detect_kind("b.odt", None) == "odt"
    assert ca.detect_kind("c.zip", None) == "zip"
    assert ca.detect_kind("d.txt", None) == "text"


def test_detect_kind_by_content_type_when_no_ext():
    assert ca.detect_kind("download", "application/pdf") == "pdf"
    assert ca.detect_kind(None, "application/zip; charset=binary") == "zip"


def test_detect_kind_unknown_and_doc():
    assert ca.detect_kind("x.bin", "application/octet-stream") == "unknown"
    assert ca.detect_kind("old.doc", None) == "doc"
    assert ca.detect_kind("x", "application/msword") == "doc"


# --------------------------------------------------------------------------- #
# 各格式抽取
# --------------------------------------------------------------------------- #
def test_convert_docx_extracts_paragraphs():
    data = _make_docx(["投標須知第一條", "履約地點:台北市"])
    rec = ca.convert_attachment_bytes("須知.docx", None, data)
    assert rec["kind"] == "docx" and rec["error"] is None
    assert "投標須知第一條" in rec["text"]
    assert "履約地點" in rec["text"]
    assert rec["char_count"] == len(rec["text"])


def test_convert_odt_extracts_paragraphs():
    data = _make_odt(["甲方應於期限內", "繳交押標金"])
    rec = ca.convert_attachment_bytes("a.odt", None, data)
    assert rec["kind"] == "odt" and rec["error"] is None
    assert "押標金" in rec["text"]


def test_convert_text_plain_big5_fallback():
    data = "中文純文字".encode("big5")
    rec = ca.convert_attachment_bytes("note.txt", None, data)
    assert rec["kind"] == "text" and rec["error"] is None
    assert rec["text"] == "中文純文字"


def test_convert_pdf_via_monkeypatch(monkeypatch):
    # 離線:不依賴 pypdf/pdfminer,直接替換 extract_pdf
    monkeypatch.setattr(ca, "extract_pdf", lambda data: "PDF 抽出內容")
    rec = ca.convert_attachment_bytes("須知.pdf", "application/pdf", b"%PDF-1.7 fake")
    assert rec["kind"] == "pdf" and rec["error"] is None
    assert rec["text"] == "PDF 抽出內容"


def test_pdf_missing_libs_records_error(monkeypatch):
    def _boom(data):
        raise ImportError("no pdf lib")

    monkeypatch.setattr(ca, "extract_pdf", _boom)
    rec = ca.convert_attachment_bytes("x.pdf", None, b"%PDF-1.7")
    assert rec["kind"] == "pdf"
    assert rec["error"] is not None and "ImportError" in rec["error"]


# --------------------------------------------------------------------------- #
# 邊界 / 安全
# --------------------------------------------------------------------------- #
def test_empty_content_records_error():
    rec = ca.convert_attachment_bytes("a.pdf", None, b"")
    assert rec["error"] == "空內容"


def test_unknown_format_records_error():
    rec = ca.convert_attachment_bytes("x.bin", "application/octet-stream", b"\x00\x01")
    assert rec["kind"] == "unknown"
    assert rec["error"] is not None


def test_doc_routed_to_doc_kind():
    # 舊版 .doc(副檔名或 OLE 檔頭)一律路由到 doc 種類,交給 extract_doc(textutil)。
    rec = ca.convert_attachment_bytes("old.doc", None, b"\xd0\xcf\x11\xe0junk")
    assert rec["kind"] == "doc"


def test_doc_unavailable_when_no_textutil(monkeypatch):
    # 模擬「非 macOS / 無 textutil」環境:extract_doc 應拋明確 RuntimeError
    monkeypatch.setattr(ca.shutil, "which", lambda _name: None)
    rec = ca.convert_attachment_bytes("old.doc", None, b"\xd0\xcf\x11\xe0junk")
    assert rec["kind"] == "doc"
    assert "textutil" in rec["error"]


def test_size_limit_enforced(monkeypatch):
    monkeypatch.setattr(ca, "MAX_BYTES", 10)
    rec = ca.convert_attachment_bytes("big.txt", None, b"0123456789ABCDEF")
    assert rec["error"] is not None and "大小上限" in rec["error"]


def test_text_char_clip(monkeypatch):
    monkeypatch.setattr(ca, "MAX_TEXT_CHARS", 5)
    data = "ABCDEFGHIJ".encode("utf-8")
    rec = ca.convert_attachment_bytes("a.txt", None, data)
    assert rec["char_count"] == 5
    assert rec["text"] == "ABCDE"


# --------------------------------------------------------------------------- #
# ZIP 遞迴 + zip-bomb 防護
# --------------------------------------------------------------------------- #
def test_zip_recurses_and_aggregates():
    inner_docx = _make_docx(["內含 DOCX 文字"])
    data = _make_zip({"a.txt": "純文字檔內容".encode("utf-8"), "b.docx": inner_docx})
    rec = ca.convert_attachment_bytes("bundle.zip", None, data)
    assert rec["kind"] == "zip" and rec["error"] is None
    assert len(rec["children"]) == 2
    kinds = {c["kind"] for c in rec["children"]}
    assert kinds == {"text", "docx"}
    # 子檔文字彙整到本層 text
    assert "純文字檔內容" in rec["text"]
    assert "內含 DOCX 文字" in rec["text"]


def test_zip_per_file_failure_isolated(monkeypatch):
    # 一個壞 docx(缺 document.xml)+ 一個好 txt → 壞的記 error,好的照常
    bad_docx = _make_zip({"notdocument.xml": b"x"})  # 當成 docx 餵會缺 document.xml
    data = _make_zip({"good.txt": "OK".encode("utf-8"), "bad.docx": bad_docx})
    rec = ca.convert_attachment_bytes("b.zip", None, data)
    children = {c["filename"]: c for c in rec["children"]}
    assert children["good.txt"]["error"] is None
    assert children["bad.docx"]["error"] is not None


def test_zip_entry_count_limit(monkeypatch):
    monkeypatch.setattr(ca, "ZIP_MAX_ENTRIES", 2)
    data = _make_zip({f"f{i}.txt": b"x" for i in range(5)})
    rec = ca.convert_attachment_bytes("many.zip", None, data)
    # 至多處理 2 檔後,出現「檔數超過上限」標記
    errs = [c.get("error") for c in rec["children"] if c.get("error")]
    assert any("檔數超過上限" in e for e in errs)


def test_zip_total_bytes_limit(monkeypatch):
    monkeypatch.setattr(ca, "ZIP_MAX_TOTAL_BYTES", 5)
    data = _make_zip({"big.txt": b"0123456789ABCDEF"})
    rec = ca.convert_attachment_bytes("z.zip", None, data)
    errs = [c.get("error") for c in rec["children"] if c.get("error")]
    assert any("解壓總量超過上限" in e for e in errs)


def test_zip_nesting_depth_limit(monkeypatch):
    monkeypatch.setattr(ca, "ZIP_MAX_DEPTH", 1)
    inner = _make_zip({"a.txt": b"deep"})
    outer = _make_zip({"inner.zip": inner})
    rec = ca.convert_attachment_bytes("outer.zip", None, outer)
    # depth 0 outer 解一層 → inner.zip 在 depth 1,觸發深度上限
    child = rec["children"][0]
    assert child["kind"] == "zip"
    assert child["error"] is not None and "巢狀" in child["error"]


# --------------------------------------------------------------------------- #
# 下載 + 轉換(下載 monkeypatch / 假 getter)
# --------------------------------------------------------------------------- #
def test_download_and_convert_with_fake_getter():
    docx = _make_docx(["下載後轉檔"])
    getter = lambda _s, _u: _Resp(docx, {"Content-Type": "application/octet-stream"})
    rec = ca.download_and_convert(
        {"url": "https://x/dl", "filename": "須知.docx"},
        session=object(), getter=getter,
    )
    assert rec["url"] == "https://x/dl"
    assert rec["kind"] == "docx"
    assert "下載後轉檔" in rec["text"]


def test_download_routes_by_content_type_when_filename_has_no_ext():
    pdf_bytes = b"%PDF-1.7 fake"
    getter = lambda _s, _u: _Resp(pdf_bytes, {"Content-Type": "application/pdf"})
    rec = ca.download_and_convert(
        {"url": "https://x/download", "filename": "download"},
        session=object(), getter=getter,
    )
    # 無副檔名 → 靠 Content-Type 判為 pdf(實際抽取走 extract_pdf;此處只驗路由)
    assert rec["kind"] == "pdf"


def test_download_failure_records_error():
    def _boom(_s, _u):
        raise RuntimeError("404")

    rec = ca.download_and_convert(
        {"url": "https://x/missing", "filename": "a.pdf"},
        session=object(), getter=_boom,
    )
    assert rec["error"] is not None and "RuntimeError" in rec["error"]


def test_download_size_limit_before_convert():
    getter = lambda _s, _u: _Resp(b"0" * 100, {"Content-Type": "text/plain"})
    rec = ca.download_and_convert(
        {"url": "https://x/big", "filename": "a.txt"},
        session=object(), getter=getter, max_bytes=10,
    )
    assert rec["error"] is not None and "大小上限" in rec["error"]


def test_download_missing_url():
    rec = ca.download_and_convert({"filename": "a.pdf"}, session=object(), getter=lambda *a: None)
    assert rec["error"] == "附件缺 url"


def test_convert_attachments_batch_isolates_failures():
    docx = _make_docx(["好檔"])

    def getter(_s, url):
        if url == "ok":
            return _Resp(docx, {"Content-Type": "application/octet-stream"})
        raise RuntimeError("boom")

    atts = [
        {"url": "ok", "filename": "a.docx"},
        {"url": "bad", "filename": "b.docx"},
    ]
    res = ca.convert_attachments(atts, session=object(), getter=getter)
    assert len(res) == 2
    assert res[0]["error"] is None and "好檔" in res[0]["text"]
    assert res[1]["error"] is not None


def test_empty_attachment_list():
    assert ca.convert_attachments([], session=object(), getter=lambda *a: None) == []
