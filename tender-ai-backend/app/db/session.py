"""非同步 engine 與 session factory。"""
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI 相依注入用：每請求一個 session。"""
    async with AsyncSessionLocal() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """FastAPI 相依注入用：回傳 session factory（非單一 session）。

    供「自管 session 生命週期」的服務使用——如 SL6 ``run_evolution`` 需呼叫自行
    commit 的 ``learn_keywords`` 並另開 session 寫稽核日誌，無法共用單一請求級 session。
    測試以 ``dependency_overrides`` 覆寫此函式即可整路改走測試庫。
    """
    return AsyncSessionLocal
