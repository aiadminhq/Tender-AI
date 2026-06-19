# -*- coding: utf-8 -*-
"""Layer C 知識/RAG models。

P3：``tender_vectors`` — 每筆標案的語意向量（name + org + category 嵌入），
供「語意搜尋」與「相似標案」。此表由公開 Corpus 衍生、可重生（Layer A 公開）
（與 P5 規劃的 ``decision_vectors``〔個案評價向量，Layer B/C，白名單合作範圍內共享、對外不揭露〕不同）。

向量維度跟著 ``EMBED_MODEL``（bge-m3 = 1024）；換模型須出新 migration 並重嵌。
向量 metadata 不含人名／email（僅標案公開欄位），符合隱私鐵則。
"""
from __future__ import annotations

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# bge-m3 向量維度；換 EMBED_MODEL 要同步改此值並出新 migration。
EMBED_DIM = 1024


class TenderVector(Base):
    __tablename__ = "tender_vectors"

    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), primary_key=True
    )
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBED_DIM), nullable=False)
    # 產生此向量的模型名（如 bge-m3）；用以偵測換模型後的過期向量並重嵌。
    model: Mapped[str] = mapped_column(String(32), nullable=False)
    # 被嵌入的原文（name + org + category）；供重嵌／除錯比對。
    content: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # HNSW + cosine：與查詢端的 <=>（cosine distance）對齊。
        Index(
            "ix_tender_vectors_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class KnowledgeChunk(Base):
    """層級 A（公開領域知識）：知識庫切塊 + 語意向量 + 斷詞索引（SL4）。

    供小助手「知識庫檢索」：把承標領域規則／方法（分級標準、PRIORITY_RULES、
    類別優先序、硬排除、預算門檻、資料源、可行度學習說明）切塊嵌入，與標案
    SQL／語意檢索並列為 grounding 證據，讓助手能回答「方法／規則」類提問。

    隱私鐵則：僅含公開領域知識，無人名／email／個案私有評語（Layer A）。
    ``tokens`` 為 jieba 斷詞後空白分隔字串，供 ``to_tsvector('simple', tokens)``
    做關鍵字（BM25-ish）檢索，與向量檢索 RRF 融合。換 EMBED_MODEL 須出新
    migration 並重嵌（同 TenderVector）。
    """

    __tablename__ = "knowledge_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 來源文件 slug（檔名去副檔名）；重嵌以此整批刪除再寫入（冪等）
    doc_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    # 文件標題（首個 H1 或檔名）
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    # 區段標題（最近的 H2/H3），供來源卡顯示脈絡；可為 None
    heading: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # 文件內切塊序（穩定排序、冪等 upsert 鍵之一）
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 切塊原文（繁中，已過濾 email）
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # jieba 斷詞後空白分隔（供 to_tsvector('simple', tokens) 關鍵字檢索）
    tokens: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # 嵌入向量（與 TenderVector 同模型同維度）
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBED_DIM), nullable=False)
    model: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("doc_id", "chunk_index", name="uq_knowledge_chunks_doc_idx"),
        # HNSW + cosine：與查詢端 <=>（cosine distance）對齊。
        Index(
            "ix_knowledge_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        # GIN(tsvector)：jieba 斷詞後關鍵字檢索（simple config，不依賴中文分詞器）。
        Index(
            "ix_knowledge_chunks_tokens_fts",
            text("to_tsvector('simple', tokens)"),
            postgresql_using="gin",
        ),
    )


class KeywordWeight(Base):
    """層級 C：關鍵字權重（由行為推導，P4 學習迴圈）。
    
    比較「被儲存/評可行」的標案 vs「開了沒動作/評不可行」的標案，
    計算詞頻差異，產出重點（positive）& 避免（negative）關鍵字。
    支援值（信心度）= 該詞出現的樣本數。
    """
    __tablename__ = "keyword_weights"

    term: Mapped[str] = mapped_column(String(128), primary_key=True)
    # 'positive'（重點詞） | 'negative'（避免詞）
    polarity: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    # TF-IDF / 詞頻比 等計算結果；絕對值越大權重越高
    weight: Mapped[float] = mapped_column(nullable=False)
    # 支援度（該詞在多少個樣本中出現），越高信心越高
    support: Mapped[int] = mapped_column(default=0, nullable=False)
    # 備註（人工干預時用）
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False, index=True
    )


class KeywordWeightRevision(Base):
    """層級 C：關鍵字權重「版本快照」（SL2 可追溯性）。

    每次 ``learn_keywords`` 跑完，把當下整批 ``KeywordWeight`` 狀態以同一個
    ``batch``（ISO8601 時間戳）寫入此表——一個 term 一列。如此可回溯
    「某次學習迭代後，每個詞的極性／權重／支援度為何」，並對照當時的
    可行／不可行樣本數，作為 self-evolve 的審計軌跡（append-only，不更新）。
    """
    __tablename__ = "keyword_weight_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 同一次學習迭代的所有 term 共用此 batch 值（ISO8601 UTC 時間戳）
    batch: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    term: Mapped[str] = mapped_column(String(128), nullable=False)
    polarity: Mapped[str] = mapped_column(String(16), nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    support: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 當次學習的樣本脈絡（每列冗餘存一份，便於單列即可解讀該批信心度）
    feasible_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    infeasible_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class EvolutionLog(Base):
    """層級 C：自我進化稽核日誌（SL6 self-evolve）。

    每次跑「進化編排」（``run_evolution``：呼叫既有 ``learn_keywords`` →
    比對前後差異 → 聚合行為信號）就 append 一列。讓「系統如何隨使用者
    行為自我演進」這條迴圈變得**可排程、可追溯、可視化**：

    - ``batch`` 連回 ``keyword_weight_revisions.batch``，可下鑽該批每個詞。
    - ``top_positive`` / ``top_negative``：當批最具代表性的重點詞／避免詞
      （[{term, weight, support}, ...]），即「系統推斷的承標判準詞彙」。
    - ``signals``：行為信號聚合（top 類別／城市／來源、事件型別計數、
      評估可行/不可行樣本數等），即「使用者實際在關注什麼」的量化快照。

    **隱私鐵則**：本表僅存 Layer A 聚合統計與公開衍生詞彙——
    無人名／email、不回放任何個別 rationale 文字或原始 payload。
    append-only，不更新（與 KeywordWeightRevision 同為稽核軌跡）。
    """
    __tablename__ = "evolution_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 連回同批 keyword_weight_revisions.batch（ISO8601 UTC 時間戳）
    batch: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # 觸發來源：'manual'（前端按鈕）｜'api'｜'auto'（排程）
    trigger: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    # 當批學習的樣本脈絡
    feasible_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    infeasible_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 與前一批相比的詞彙異動量
    keywords_added: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    keywords_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revision_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 當批 top 重點詞／避免詞（[{term, weight, support}, ...]，Layer A 公開詞彙）
    top_positive: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    top_negative: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # 行為信號聚合快照（Layer A 聚合統計，無 PII）
    signals: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class DocSummary(Base):
    """層級 C：招標文件摘要（P4/P5 用）。
    
    enrich_details 產出詳情後，可由 LLM 自動摘要；
    或人工標記要點。供 RAG 與決策助手引用。
    """
    __tablename__ = "doc_summaries"

    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), primary_key=True
    )
    # LLM 產生的摘要
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 提煉的關鍵詞（逗號分隔或 JSON array）
    key_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 源文件 URL（來自詳情頁的招標公告連結）
    source_doc_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False
    )


class DecisionVector(Base):
    """層級 C：評估決策向量（P5 用；白名單合作範圍內共享、對外不揭露）。
    
    每筆 evaluation（user_id, tender_id, feasible, criteria, rationale）
    嵌入為向量；用以尋找「類似可行案」與「相似不可行案」。
    向量 metadata 不含人名／email，僅標案公開欄位 + 評估結果。
    """
    __tablename__ = "decision_vectors"

    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("evaluations.id", ondelete="CASCADE"), primary_key=True
    )
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # 'bge-m3' 等；換模型須重嵌並出新 migration
    model: Mapped[str] = mapped_column(String(32), nullable=False)
    # (rationale + criteria JSON) 的嵌入向量
    embedding: Mapped[list[float]] = mapped_column(
        Vector(EMBED_DIM), nullable=False
    )
    # 原始評估內容（rationale + criteria）；用於重嵌／除錯
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 評估結論（'可行' | '不可行' | '待議'），供元數據過濾
    feasible: Mapped[str] = mapped_column(String(16), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # HNSW + cosine
        Index(
            "ix_decision_vectors_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
