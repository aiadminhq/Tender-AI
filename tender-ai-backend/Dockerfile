FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    libpq-dev gcc libxml2-dev libxslt-dev curl \
    && rm -rf /var/lib/apt/lists/*

# 從官方映像複製 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# 先複製鎖定檔，讓相依層可被快取
COPY pyproject.toml uv.lock ./

# 安裝所有 production 相依套件到 .venv（uv sync 自動建立）
RUN uv sync --frozen --no-dev --no-install-project

# 複製應用程式碼
COPY . .

EXPOSE 8000

# Railway 會提供 $PORT；alembic 先跑 migration 再啟動 server
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
