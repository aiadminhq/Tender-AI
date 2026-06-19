# -*- coding: utf-8 -*-
"""知識庫關鍵字索引共用工具（SL4）。

提供 ingestion job 與檢索服務共用的：
- ``tokenize_cn``：jieba 離線斷詞（與 learn_keywords 同策略），供 ``to_tsvector
  ('simple', tokens)`` 的關鍵字（BM25-ish）檢索。
- ``strip_emails``：嵌入／入庫前防禦性移除 email，落實 Layer A 隱私鐵則。
- ``tokens_string``：把斷詞結果接成空白分隔字串，存入 ``knowledge_chunks.tokens``。

鐵則：不連網；jieba 使用套件 bundled 詞典，純離線。
"""
from __future__ import annotations

import re

import jieba

# 顯式初始化：首次 cut 才 lazy-load 詞典，先載好避免測試／首呼延遲。離線、不連網。
jieba.initialize()

# 僅保留長度 ≥2、且為中文或英數的詞元（濾掉標點、空白、混雜符號）
_TOKEN_OK = re.compile(r"^[\w一-鿿]+$")

# email 偵測（防禦性移除，避免任何個資混入公開語料／向量）
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def strip_emails(text: str) -> str:
    """移除字串中的 email（以空白替代），落實 Layer A 無個資鐵則。"""
    if not text:
        return text
    return _EMAIL_RE.sub(" ", text)


def tokenize_cn(text: str) -> list[str]:
    """以 jieba 斷詞（離線 bundled dict、不連網）。

    僅保留長度 ≥2、且為中文或英數的詞元；標點與單字雜訊一律過濾。
    與 ``app.jobs.learn_keywords._tokenize_cn`` 採同一策略，確保索引／查詢一致。
    """
    if not text:
        return []
    tokens: list[str] = []
    for tok in jieba.cut(text):
        tok = tok.strip().lower()
        if len(tok) >= 2 and _TOKEN_OK.match(tok):
            tokens.append(tok)
    return tokens


def tokens_string(text: str) -> str:
    """斷詞後接成空白分隔字串，供存入 ``knowledge_chunks.tokens``。"""
    return " ".join(tokenize_cn(text))
