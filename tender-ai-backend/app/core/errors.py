# -*- coding: utf-8 -*-
"""服務層共用例外（由 API 層轉成對應的 HTTP 回應）。"""
from __future__ import annotations


class EntityNotFound(Exception):
    """查無資源（標案／使用者等）；API 層轉 404。"""

    def __init__(self, detail: str = "not found") -> None:
        self.detail = detail
        super().__init__(detail)


class PermissionDenied(Exception):
    """權限不足（非管理員／非本人／帳號未在白名單內）；API 層轉 403。"""

    def __init__(self, detail: str = "forbidden") -> None:
        self.detail = detail
        super().__init__(detail)


class DomainValidationError(Exception):
    """業務驗證失敗（如信箱非 @hqdesign.tw 網域）；API 層轉 422。"""

    def __init__(self, detail: str = "unprocessable entity") -> None:
        self.detail = detail
        super().__init__(detail)


class AuthNotConfigured(RuntimeError):
    """AUTH_SECRET 未設定：fail-closed 拒絕簽發／驗證 token；API 層轉 503（可辨識，非不透明 500）。"""

    def __init__(
        self,
        detail: str = "伺服器鑑權尚未設定（AUTH_SECRET），暫時無法處理需登入的請求",
    ) -> None:
        self.detail = detail
        super().__init__(detail)
