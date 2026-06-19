# -*- coding: utf-8 -*-
"""附件歸檔 service archiver 的離線測試(不連網,以假 getter 注入回應)。

涵蓋:正常落地 + storage_uri、Content-Disposition 檔名、Content-Type 補副檔名、
sha256 idempotent 跳過、同名異容加序號、空清單、單檔失敗不影響其餘。
"""
from __future__ import annotations

from app.services.archiver import archive_attachments


class _Resp:
    """最小回應替身:content + headers。"""

    def __init__(self, content: bytes, headers: dict | None = None):
        self.content = content
        self.headers = headers or {}


def _getter(mapping: dict):
    """回傳依 url 取 _Resp 的 fake getter;url 不在 mapping 則 raise(模擬下載失敗)。"""
    def _g(_session, url):
        if url not in mapping:
            raise RuntimeError(f"404 {url}")
        return mapping[url]
    return _g


def test_archive_lands_file_and_storage_uri(tmp_path):
    atts = [{"filename": "投標須知下載", "url": "https://x/dl?pk=1"}]
    getter = _getter({"https://x/dl?pk=1": _Resp(b"%PDF-1.7 data", {"Content-Type": "application/pdf"})})
    res = archive_attachments("PCC", "71252818", atts, base_dir=tmp_path, session=object(), getter=getter)

    assert len(res) == 1
    r = res[0]
    assert r["error"] is None and r["skipped"] is False
    # 無 Content-Disposition → 用標籤 + .pdf
    assert r["filename"] == "投標須知下載.pdf"
    assert r["storage_uri"] == "PCC/71252818/投標須知下載.pdf"
    # 實檔落地且內容正確
    landed = tmp_path / "PCC" / "71252818" / "投標須知下載.pdf"
    assert landed.read_bytes() == b"%PDF-1.7 data"


def test_content_disposition_filename_wins(tmp_path):
    atts = [{"filename": "投標須知下載", "url": "u"}]
    getter = _getter({"u": _Resp(b"abc", {"Content-Disposition": 'attachment; filename="須知_115BA035.pdf"'})})
    res = archive_attachments("PCC", "c1", atts, base_dir=tmp_path, session=object(), getter=getter)
    assert res[0]["filename"] == "須知_115BA035.pdf"


def test_idempotent_skip_same_content(tmp_path):
    atts = [{"filename": "doc", "url": "u"}]
    getter = _getter({"u": _Resp(b"same", {"Content-Type": "application/pdf"})})
    first = archive_attachments("PCC", "c1", atts, base_dir=tmp_path, session=object(), getter=getter)
    second = archive_attachments("PCC", "c1", atts, base_dir=tmp_path, session=object(), getter=getter)
    assert first[0]["skipped"] is False
    assert second[0]["skipped"] is True  # 雜湊相同 → 跳過寫入
    assert first[0]["storage_uri"] == second[0]["storage_uri"]


def test_same_name_different_content_gets_serial(tmp_path):
    getter1 = _getter({"u": _Resp(b"v1", {"Content-Type": "application/pdf"})})
    getter2 = _getter({"u": _Resp(b"v2", {"Content-Type": "application/pdf"})})
    a = archive_attachments("PCC", "c1", [{"filename": "doc", "url": "u"}], base_dir=tmp_path, session=object(), getter=getter1)
    b = archive_attachments("PCC", "c1", [{"filename": "doc", "url": "u"}], base_dir=tmp_path, session=object(), getter=getter2)
    assert a[0]["filename"] == "doc.pdf"
    assert b[0]["filename"] == "doc-1.pdf"  # 同名異容 → 加序號,不覆蓋
    assert (tmp_path / "PCC" / "c1" / "doc.pdf").read_bytes() == b"v1"
    assert (tmp_path / "PCC" / "c1" / "doc-1.pdf").read_bytes() == b"v2"


def test_empty_attachments_returns_empty(tmp_path):
    assert archive_attachments("PCC", "c1", [], base_dir=tmp_path, session=object(), getter=_getter({})) == []


def test_per_file_failure_isolated(tmp_path):
    atts = [
        {"filename": "ok", "url": "good"},
        {"filename": "bad", "url": "missing"},  # getter 會 raise
    ]
    getter = _getter({"good": _Resp(b"ok", {"Content-Type": "application/pdf"})})
    res = archive_attachments("PCC", "c1", atts, base_dir=tmp_path, session=object(), getter=getter)
    assert res[0]["error"] is None and res[0]["storage_uri"] == "PCC/c1/ok.pdf"
    assert res[1]["error"] is not None and res[1]["storage_uri"] is None
