"""ORM models 匯總（供 Alembic autogenerate 掃描 Base.metadata）。

- Layer A 標案 Corpus：公開可重生。
- Layer B 行為/回饋：白名單合作範圍內共享、對外不揭露（資料永不進公開 repo，但 schema/code 需入版控）。
- Layer C 知識/RAG：tender_vectors（P3，公開衍生向量）。
"""
from app.models.assistant import (
    AssistantBrainConfig,
    AssistantMessage,
    AssistantThread,
)
from app.models.behavior import (
    Annotation,
    Evaluation,
    Event,
    SavedSearch,
    Share,
    TenderUserState,
    User,
)
from app.models.knowledge import (
    DecisionVector,
    DocSummary,
    EvolutionLog,
    KeywordWeight,
    KeywordWeightRevision,
    KnowledgeChunk,
    TenderVector,
    UserKeywordWeight,
)
from app.models.preference import PreferenceProfile
from app.models.push import PushLog
from app.models.revision import (
    CrawlFailure,
    CrawlRun,
    TenderRevision,
    TenderSnapshot,
)
from app.models.tender import DailyRun, DailyTender, Source, Tender

__all__ = [
    # Layer A
    "Source",
    "Tender",
    "DailyRun",
    "DailyTender",
    # Layer A 詳情 enrich(revision-first)
    "TenderSnapshot",
    "TenderRevision",
    "CrawlRun",
    "CrawlFailure",
    # Layer B
    "User",
    "Event",
    "TenderUserState",
    "Annotation",
    "Evaluation",
    "Share",
    "SavedSearch",
    "PushLog",
    # 小助手對話留存（Phase 4）
    "AssistantThread",
    "AssistantMessage",
    # 小助手「大腦」全域設定
    "AssistantBrainConfig",
    # Layer C
    "TenderVector",
    "KnowledgeChunk",
    "KeywordWeight",
    "KeywordWeightRevision",
    "UserKeywordWeight",
    "PreferenceProfile",
    "EvolutionLog",
    "DocSummary",
    "DecisionVector",
]
