# -*- coding: utf-8 -*-
"""階段三附件入庫的**離線純函式**回歸測試。

只測不連網、不碰 DB/Ollama 的純函式：RFC2047 變體檔名還原、檔頭 magic 型別嗅探、
doc_id 規則。``run_ingest_attachments`` 需 Ollama+DB，依專案慣例不在 CI 跑。
"""
from __future__ import annotations

import base64
import zipfile
from io import BytesIO

from app.jobs.ingest_attachments import _decode_mime_name, _doc_id, _sniff_content_type


def _mime_name(text: str) -> str:
    """造一個與 archiver 落地一致的 RFC2047 變體檔名（`?` → `_`）。"""
    payload = base64.b64encode(text.encode("utf-8")).decode("ascii")
    return f"=_UTF-8_B_{payload}_="


def test_decode_mime_name_roundtrip_zh():
    name = "01_投標須知（1141231）.odt"
    assert _decode_mime_name(_mime_name(name)) == name


def test_decode_mime_name_passthrough_plain():
    # 非編碼檔名原樣回傳（PCC 偶有未編碼的純檔名）
    assert _decode_mime_name("4.投標須知.pdf") == "4.投標須知.pdf"
    assert _decode_mime_name(None) == ""


def test_sniff_pdf():
    assert _sniff_content_type(b"%PDF-1.7\n...") == "application/pdf"


def test_sniff_odt():
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text")
        z.writestr("content.xml", "<x/>")
    assert _sniff_content_type(buf.getvalue()) == "application/vnd.oasis.opendocument.text"


def test_sniff_docx():
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<x/>")
        z.writestr("word/document.xml", "<x/>")
    assert (
        _sniff_content_type(buf.getvalue())
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


def test_sniff_old_doc_ole_is_none():
    # 舊版 .doc（OLE 複合檔頭）不支援解析 → 不給型別提示
    assert _sniff_content_type(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest") is None


def test_doc_id_rule():
    assert _doc_id("71235010") == "attach-PCC-71235010"
