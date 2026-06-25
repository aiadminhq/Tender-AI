// 設定頁「小助手大腦」client：對接後端 GET/PUT /settings/brain。
// 選擇 AI 助手視窗背後由哪個 provider 生成：ollama（本機換模型）／cli（spawn 本機
// headless CLI 自主 agentic）／byok（自帶金鑰直連雲端）。
// secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進後端 .env；前端只讀寫非密欄位，
// byokKeySet 為唯讀衍生布林（金鑰是否已設定），永不取得金鑰本體。
// 契約見 tender-ai-backend/app/schemas/settings.py。

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  // 區網分享：dev 走相對 /api/v1（由 vite proxy 轉本機後端），靜態 build 維持絕對 localhost。
  (import.meta.env.DEV ? "/api/v1" : "http://localhost:8000/api/v1");

function authHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  return key ? { "X-API-Key": key } : {};
}

export type BrainProvider = "ollama" | "cli" | "byok";
export type CliAgent = "claude" | "codex" | "hermes";

// 對齊後端 BrainConfigOut（snake_case → camelCase）。
export interface BrainConfig {
  provider: BrainProvider;
  ollamaModel: string | null;
  cliAgent: string | null;
  byokProtocol: string | null;
  byokBaseUrl: string | null;
  byokModel: string | null;
  byokKeySet: boolean;
  updatedAt: string | null;
}

// 對齊後端 BrainConfigUpdate；只送要改的欄位。
export interface BrainConfigUpdate {
  provider?: BrainProvider;
  ollamaModel?: string | null;
  cliAgent?: CliAgent | null;
  byokProtocol?: "anthropic" | null;
  byokBaseUrl?: string | null;
  byokModel?: string | null;
}

interface BrainConfigDto {
  provider: BrainProvider;
  ollama_model: string | null;
  cli_agent: string | null;
  byok_protocol: string | null;
  byok_base_url: string | null;
  byok_model: string | null;
  byok_key_set: boolean;
  updated_at: string | null;
}

function adaptConfig(dto: BrainConfigDto): BrainConfig {
  return {
    provider: dto.provider,
    ollamaModel: dto.ollama_model,
    cliAgent: dto.cli_agent,
    byokProtocol: dto.byok_protocol,
    byokBaseUrl: dto.byok_base_url,
    byokModel: dto.byok_model,
    byokKeySet: dto.byok_key_set,
    updatedAt: dto.updated_at,
  };
}

/** 讀取目前大腦設定。 */
export async function fetchBrainConfig(
  signal?: AbortSignal,
): Promise<BrainConfig> {
  const res = await fetch(`${API_BASE}/settings/brain`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`brain config API ${res.status}`);
  return adaptConfig((await res.json()) as BrainConfigDto);
}

/** 部分更新大腦設定（未送欄位不動）。回傳更新後的設定。 */
export async function updateBrainConfig(
  changes: BrainConfigUpdate,
  signal?: AbortSignal,
): Promise<BrainConfig> {
  const body: Record<string, unknown> = {};
  if (changes.provider !== undefined) body.provider = changes.provider;
  if (changes.ollamaModel !== undefined)
    body.ollama_model = changes.ollamaModel;
  if (changes.cliAgent !== undefined) body.cli_agent = changes.cliAgent;
  if (changes.byokProtocol !== undefined)
    body.byok_protocol = changes.byokProtocol;
  if (changes.byokBaseUrl !== undefined)
    body.byok_base_url = changes.byokBaseUrl;
  if (changes.byokModel !== undefined) body.byok_model = changes.byokModel;

  const res = await fetch(`${API_BASE}/settings/brain`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`brain config API ${res.status}`);
  return adaptConfig((await res.json()) as BrainConfigDto);
}
