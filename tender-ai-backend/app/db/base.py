"""SQLAlchemy 2.0 宣告式 Base。

所有 model 繼承此 Base；Alembic 透過 import models 後讀 Base.metadata 自動產生 migration。
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
