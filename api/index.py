# -*- coding: utf-8 -*-
"""Vercel Python Runtime 進入點：把 tender-ai-backend 的 FastAPI app 掛成 ASGI function。

部署模型（同源全棧）：前端靜態檔與這支 function 掛在同一個 Vercel 部署下，
`/api/*` 由 vercel.json rewrite 導到本 function（ASGI 收到的是原始請求路徑，
故 FastAPI 既有的 `/api/v1/...` 路由不需改動），其餘路徑回落 SPA index.html。
同源部署免 CORS 設定；前端 API_BASE 預設相對路徑 `/api/v1` 自動對齊任何網域。

`app/` package 位於 `tender-ai-backend/`（目錄名含連字號、非合法 module 名），
故先把該目錄塞進 sys.path 才能 `import app.main`。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tender-ai-backend"))

from app.main import app  # noqa: E402, F401
