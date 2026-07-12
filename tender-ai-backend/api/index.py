# -*- coding: utf-8 -*-
"""Vercel Python Runtime 進入點：把 tender-ai-backend 的 FastAPI app 掛成 ASGI function。

Vercel 的 Python builder 會在這個檔案所在目錄啟動，`app/` package 位於上一層，
故先把上層目錄塞進 sys.path 才能 `import app.main`。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402
