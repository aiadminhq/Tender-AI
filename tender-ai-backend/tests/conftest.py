# -*- coding: utf-8 -*-
"""DB 後端整合測試的共用 fixtures。

設計重點：
- 使用獨立測試庫 ``tenderai_test``（不碰開發庫 ``tenderai``）；不存在則自動建立。
- Postgres 連不到時整批 skip（CI 不一定有 DB，且本後端不在 CI 連 PCC）。
- schema 以 ``Base.metadata.create_all`` 建（含 Layer C 向量欄位與 HNSW 索引）；
  建表前先 ``CREATE EXTENSION IF NOT EXISTS vector``，故 ``tender_vectors`` 的
  ``vector(1024)`` 欄位可成立。模型即 schema 單一真相，與 Alembic 同源。
- 每個測試前 ``TRUNCATE ... RESTART IDENTITY CASCADE``，確保隔離與可預期的自增 id。
- 以 ``app.dependency_overrides`` 覆寫 ``get_session``，讓 API 走測試庫 session。

資料硬規則（Layer B）：本層僅用合成種子資料測試，真實行為/評價資料永不進版控。
"""
from __future__ import annotations

from datetime import date

import psycopg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

import app.models  # noqa: F401  匯入所有 model 進 Base.metadata
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session, get_session_factory
from app.main import app

# 測試庫 URL：開發庫名加上 _test 後綴（postgresql+psycopg → 同步/非同步同一 driver）
_BASE_URL = make_url(settings.database_url)
_TEST_DB = (_BASE_URL.database or "tenderai") + "_test"
TEST_URL = _BASE_URL.set(database=_TEST_DB)

# TRUNCATE 用的完整表清單（CASCADE 處理 FK 次序）
_ALL_TABLES = [
    "assistant_messages",
    "assistant_threads",
    "assistant_brain_config",
    "events",
    "annotations",
    "evaluations",
    "shares",
    "saved_searches",
    "push_logs",
    "evolution_logs",
    "tender_user_state",
    "daily_tender",
    "daily_runs",
    "tender_vectors",
    "knowledge_chunks",
    "decision_vectors",
    "doc_summaries",
    "keyword_weight_revisions",
    "keyword_weights",
    "user_keyword_weights",
    "preference_profiles",
    "user_manual_keywords",
    "crawl_failures",
    "tender_revisions",
    "tender_snapshots",
    "crawl_runs",
    "tenders",
    "users",
    "sources",
]

# 模組層級的非同步引擎：NullPool 確保每次連線在當前 test 的 event loop 內開/關，
# 避免 session-scope 引擎跨 function-scope loop 造成的 "attached to a different loop"。
test_async_engine = create_async_engine(TEST_URL, poolclass=NullPool)
TestSessionLocal = async_sessionmaker(
    test_async_engine, class_=AsyncSession, expire_on_commit=False
)


async def _override_get_session():
    async with TestSessionLocal() as session:
        yield session


# API 走測試庫 session（key 必須是 routers 匯入的同一個 get_session 物件）
app.dependency_overrides[get_session] = _override_get_session
# 自管 session 生命週期的服務（如 SL6 run_evolution）注入的是 factory；整路改走測試庫。
app.dependency_overrides[get_session_factory] = lambda: TestSessionLocal


def _admin_dsn() -> str:
    """維護連線的 libpq 連線字串（用於 CREATE DATABASE）。

    用既有的開發庫（tenderai）當維護庫，而非 ``postgres``：brew 原生安裝
    不一定建有 ``postgres`` 庫，連既有開發庫最不會誤觸發整批 skip。
    """
    return (
        f"host={_BASE_URL.host or 'localhost'} "
        f"port={_BASE_URL.port or 5432} "
        f"user={_BASE_URL.username} "
        f"password={_BASE_URL.password} "
        f"dbname={_BASE_URL.database or 'postgres'}"
    )


def _ensure_test_database() -> None:
    """建立測試庫（若不存在）。Postgres 連不到時拋 OperationalError，由上層轉 skip。"""
    with psycopg.connect(_admin_dsn(), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (_TEST_DB,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{_TEST_DB}"')


@pytest.fixture(scope="session", autouse=True)
def _prepare_database():
    """建立測試庫並重置 schema；Postgres 不可用則整批 skip。"""
    try:
        _ensure_test_database()
    except psycopg.OperationalError as exc:
        pytest.skip(f"Postgres 連不到，略過 DB 整合測試：{exc}")

    sync_engine = create_engine(TEST_URL)  # 同步引擎，建/重置 schema
    with sync_engine.begin() as conn:
        # Layer C 向量欄位（vector(1024)）需先有 pgvector 擴充；正式環境由 Alembic 首版建立。
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()
    yield


@pytest_asyncio.fixture(autouse=True)
async def _truncate_tables(_prepare_database):
    """每個測試前清空所有表並重置自增 id，確保隔離與可預期的 id。"""
    async with test_async_engine.begin() as conn:
        await conn.execute(
            text(f"TRUNCATE {', '.join(_ALL_TABLES)} RESTART IDENTITY CASCADE")
        )
    yield


@pytest_asyncio.fixture
async def client():
    """以 ASGI transport 直連 app 的 httpx 非同步 client。"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def db_session():
    """測試直接讀寫 DB 用的獨立 session（與 API 用的 session 分離）。"""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
def session_factory():
    """自管 session 生命週期的服務/種子腳本（如 seed_members）注入測試庫 factory。"""
    return TestSessionLocal


@pytest.fixture
def ollama_brain(monkeypatch):
    """把全域「大腦」設定釘成 ollama，供測 Ollama 生成路徑的測試使用。

    產品預設大腦已改為 cli/Claude Code（見 brain_config.get_or_create），會 spawn 本機
    CLI；但 /assistant/chat 的 LLM 生成/grounding/fallback 測試是針對 ollama 路徑、以
    monkeypatch ``llm.stream_chat`` 驗證，故在這些模組以本 fixture 固定 provider=ollama，
    避免改走 cli 分支真的去 spawn 子程序。模組層以 ``pytestmark = usefixtures`` 套用。
    """

    class _OllamaCfg:
        provider = "ollama"
        ollama_model = None

    async def _fake_get_or_create(session):
        return _OllamaCfg()

    monkeypatch.setattr(
        "app.services.brain_config.get_or_create", _fake_get_or_create
    )


async def seed_basic(session: AsyncSession) -> dict[str, int]:
    """植入一組可涵蓋各篩選/排序情境的合成標案。

    回傳 label → tender_id 對照：
      high：tier=high、days=3、budget=500（台北/財物，PCC）；含兩筆快照證明取最新。
      mid ：tier=mid 、days=7、budget=1200（新北/工程，PCC）。
      low ：tier=low 、days=1、budget=80（桃園/勞務，PCC）；最急但低 tier，用以分辨 days vs tier 排序。
      tmu ：無快照（tier/days 皆 NULL）、budget=NULL（TMU），用以驗證 null 殿後與 src 篩選。
    """
    from app.models.tender import DailyTender, Source, Tender

    pcc = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    tmu = Source(name="TMU", base_url="https://cmd.tmu.edu.tw")
    session.add_all([pcc, tmu])
    await session.flush()

    d_old = date(2026, 6, 15)
    d_new = date(2026, 6, 17)

    t_high = Tender(
        source_id=pcc.id,
        case_pk="PCC-H",
        name="台北市政府資訊系統建置案",
        org="台北市政府",
        category="財物",
        budget_wan=500,
        deadline_roc="115/06/20",
        deadline_iso=date(2026, 6, 20),
        tender_method="公開招標",
        city="台北市",
        link="https://example.test/h",
        first_seen=d_old,
        last_seen=d_new,
    )
    t_mid = Tender(
        source_id=pcc.id,
        case_pk="PCC-M",
        name="新北市道路工程改善",
        org="新北市政府",
        category="工程",
        budget_wan=1200,
        deadline_roc="115/06/24",
        deadline_iso=date(2026, 6, 24),
        tender_method="公開招標",
        city="新北市",
        link="https://example.test/m",
        first_seen=d_new,
        last_seen=d_new,
    )
    t_low = Tender(
        source_id=pcc.id,
        case_pk="PCC-L",
        name="桃園市清潔勞務委外",
        org="桃園市環保局",
        category="勞務",
        budget_wan=80,
        deadline_roc="115/07/07",
        deadline_iso=date(2026, 7, 7),
        tender_method="公開招標",
        city="桃園市",
        link="https://example.test/l",
        first_seen=d_new,
        last_seen=d_new,
    )
    t_tmu = Tender(
        source_id=tmu.id,
        case_pk="TMU-1",
        name="北醫醫療設備採購",
        org="臺北醫學大學",
        category=None,
        budget_wan=None,
        deadline_roc=None,
        deadline_iso=None,
        tender_method=None,
        city=None,
        link="https://example.test/t",
        first_seen=d_new,
        last_seen=d_new,
    )
    session.add_all([t_high, t_mid, t_low, t_tmu])
    await session.flush()

    session.add_all(
        [
            # high：舊快照 low/10，新快照 high/3 → 取最新應為 high/3
            DailyTender(run_date=d_old, tender_id=t_high.id, tier="low", days_left=10),
            DailyTender(run_date=d_new, tender_id=t_high.id, tier="high", days_left=3),
            DailyTender(run_date=d_new, tender_id=t_mid.id, tier="mid", days_left=7),
            DailyTender(run_date=d_new, tender_id=t_low.id, tier="low", days_left=1),
            # t_tmu 無快照 → tier/days_left 為 NULL
        ]
    )
    await session.commit()

    return {
        "high": t_high.id,
        "mid": t_mid.id,
        "low": t_low.id,
        "tmu": t_tmu.id,
    }


@pytest_asyncio.fixture
async def seeded():
    """植入合成資料並回傳 label → tender_id（用獨立 session，植入後即關閉）。"""
    async with TestSessionLocal() as session:
        return await seed_basic(session)
