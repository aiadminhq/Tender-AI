"""應用設定：以 pydantic-settings 讀取 .env／環境變數。

欄位名對應 .env 的大寫變數（pydantic-settings 不分大小寫）。
預設值即本機 brew 原生開發環境，故無 .env 時亦可直接跑起來；
secret（ANTHROPIC_API_KEY／APP_API_KEY）預設空字串，正式環境放系統 secret。
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # 關聯式 + 向量同一引擎（SQLAlchemy async + psycopg 3 驅動）
    database_url: str = "postgresql+psycopg://tender:tender@localhost:5432/tenderai"

    # 本機 Ollama（embeddings）；維度跟著 EMBED_MODEL（bge-m3 = 1024）
    ollama_url: str = "http://localhost:11434"
    embed_model: str = "bge-m3"

    # SL1：小助手本機生成（Ollama /api/chat）。模型需已 `ollama pull`。
    chat_model: str = "qwen3.5:9b"
    assistant_use_llm: bool = True  # 關閉時退回模板回答（CI／無 Ollama 環境）
    chat_timeout: float = 60.0  # httpx 連線／單次讀取逾時（秒）
    chat_deadline: float = 90.0  # 單次生成總時長硬上限（秒）；逾時即收尾
    chat_num_predict: int = 700  # 生成 token 上限（界定生成長度／成本）
    chat_temperature: float = 0.3  # 偏低溫度：貼證據、少發散
    assistant_max_concurrency: int = 2  # 本機 Ollama 同時生成上限（Semaphore）

    # 高品質推理/摘要（P5）；勿入版控
    anthropic_api_key: str = ""

    # 既有爬蟲核心位置（包裝呼叫，不重寫）
    pcc_scraper_path: str = "../tender-bot/tender_daily.py"

    # SL4：知識庫語料目錄（公開領域知識 *.md；ingest_knowledge 由此讀檔切塊嵌入）
    knowledge_dir: str = "knowledge"

    # SL5 主動推播每日摘要：依學習到的承標判準挑高潛力標案，記成站內推播。
    # 站內（in_app）為主，內容只引用 Layer A 公開欄位；未來如接外部頻道，
    # 其 token 一律走 .env（gitignored），不入版控、不寫進 push_logs 內容。
    push_daily_limit: int = 8  # 單次批次最多推幾筆
    push_min_score: int = 60  # 顯示可行度門檻（≥ 才納入候選）
    push_lookback_days: int = 7  # 跨日去重視窗（近 N 天已推不重複）

    # 簡易後端保護
    app_api_key: str = ""

    # 白名單登入（@hqdesign.tw）：app 自簽 JWT（HS256）。secret 留空時登入端點直接拒絕，
    # 避免正式環境誤用預設密鑰簽發可偽造的 token。
    jwt_secret: str = ""
    jwt_expire_minutes: int = 720  # 12 小時
    company_domain: str = "@hqdesign.tw"

    # 前端跨源呼叫允許來源（逗號分隔字串）；預設本機 Vite 開發埠（5173／5174）
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174"
    )

    # 本機開發放行任意 localhost 埠（含 Claude Preview 代理動態埠）；
    # 正式環境留空、僅以 cors_origins 白名單為準。
    cors_origin_regex: str = r"http://(localhost|127\.0\.0\.1):\d+"

    @property
    def cors_origins_list(self) -> list[str]:
        """將逗號分隔的 CORS 來源拆成清單（空白項剔除）。"""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
