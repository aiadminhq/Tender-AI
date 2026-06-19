# -*- coding: utf-8 -*-
"""服務層共用例外（由 API 層轉成對應的 HTTP 回應）。"""
from __future__ import annotations


class EntityNotFound(Exception):
    """查無資源（標案／使用者等）；API 層轉 404。"""

    def __init__(self, detail: str = "not found") -> None:
        self.detail = detail
        super().__init__(detail)
