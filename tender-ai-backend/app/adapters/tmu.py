# -*- coding: utf-8 -*-
"""北醫聯合採購 adapter(第二資料源)。

本階段**不支援詳情 enrich**(``supports_detail_enrich=False``):僅在 registry 佔位,
讓 ``source_seeds()`` 能建立其 ``sources`` 列、enrich job 能據旗標略過,不報 failure。
"""
from __future__ import annotations

from app.adapters.base import SourceAdapter


class TMUAdapter(SourceAdapter):
    source_name = "TMU"
    base_url = "https://cmd.tmu.edu.tw"
    supports_detail_enrich = False
