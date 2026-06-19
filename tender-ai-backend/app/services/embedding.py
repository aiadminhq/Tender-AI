# -*- coding: utf-8 -*-
"""Embedding 服務：呼叫本機 Ollama 產生語意向量（bge-m3，1024 維）。

- 走 Ollama 批次端點 ``POST {ollama_url}/api/embed``
  body ``{"model": "bge-m3", "input": [texts...]}`` → resp ``{"embeddings": [[...], ...]}``。
- 維度固定 ``EMBED_DIM``（1024）；回傳維度／數量不符即 ``EmbeddingError``
  （換模型須出新 migration 並重嵌，見 app.models.knowledge）。
- 僅嵌入標案公開欄位（name + org + category），不含人名／email（隱私鐵則）。
- CI／測試不連 Ollama：以 ``monkeypatch.setattr("app.services.embedding.embed_query", ...)``
  替換；故呼叫端請用模組屬性存取（``embedding.embed_query(...)``）而非 import 後綁定。
"""
from __future__ import annotations

import httpx

from app.core.config import settings
from app.models.knowledge import EMBED_DIM


def tender_text(name: str, org: str | None = None, category: str | None = None) -> str:
    """組裝被嵌入的原文：name + org + category，略過空欄位。

    與 query._haystack（關鍵字比對欄位）對齊，確保語意向量與關鍵字檢索同源。
    """
    return " ".join(p for p in (name, org, category) if p)


class EmbeddingError(RuntimeError):
    """Embedding 後端呼叫失敗，或回傳格式／維度／數量異常。"""


async def embed_texts(
    texts: list[str],
    *,
    model: str | None = None,
    url: str | None = None,
    timeout: float = 60.0,
) -> list[list[float]]:
    """批次嵌入：回傳與 ``texts`` 等長、各為 ``EMBED_DIM`` 維的向量清單。

    空輸入回空清單（不打 Ollama）。任何網路／格式／維度問題一律 ``EmbeddingError``。
    """
    if not texts:
        return []
    model = model or settings.embed_model
    base = (url or settings.ollama_url).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{base}/api/embed", json={"model": model, "input": texts}
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:  # 連線逾時／非 2xx／JSON 解析等
        raise EmbeddingError(f"Ollama 呼叫失敗：{e}") from e

    vectors = data.get("embeddings")
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        got = len(vectors) if isinstance(vectors, list) else type(vectors).__name__
        raise EmbeddingError(f"Ollama 回傳向量數不符：期望 {len(texts)}，得到 {got}")
    for v in vectors:
        if not isinstance(v, list) or len(v) != EMBED_DIM:
            got = len(v) if isinstance(v, list) else type(v).__name__
            raise EmbeddingError(f"向量維度不符：期望 {EMBED_DIM}，得到 {got}")
    return vectors


async def embed_query(text: str, **kw) -> list[float]:
    """單筆查詢嵌入（語意搜尋用）；回傳一個 ``EMBED_DIM`` 維向量。"""
    vectors = await embed_texts([text], **kw)
    return vectors[0]
