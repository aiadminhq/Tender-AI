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
// CLI 代理 key 改為註冊表驅動（後端單一事實來源），不再是封閉 union；
// 前端用 string，合法值由 fetchBrainAgents 動態取得。
export type CliAgent = string;

// 對齊後端 BrainConfigOut（snake_case → camelCase）。
export interface BrainConfig {
  provider: BrainProvider;
  ollamaModel: string | null;
  cliAgent: string | null;
  cliModel: string | null;
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
  cliModel?: string | null;
  byokProtocol?: "anthropic" | null;
  byokBaseUrl?: string | null;
  byokModel?: string | null;
}

interface BrainConfigDto {
  provider: BrainProvider;
  ollama_model: string | null;
  cli_agent: string | null;
  cli_model: string | null;
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
    cliModel: dto.cli_model,
    byokProtocol: dto.byok_protocol,
    byokBaseUrl: dto.byok_base_url,
    byokModel: dto.byok_model,
    byokKeySet: dto.byok_key_set,
    updatedAt: dto.updated_at,
  };
}

// 對齊後端 BrainAgentSpec：一個 CLI 代理的可選資訊（GET /settings/brain/agents）。
export interface BrainAgentSpec {
  key: string;
  labelI18n: string;
  models: string[];
  defaultModel: string | null;
  supportsModel: boolean;
  needsLocalVerify: boolean;
}

interface BrainAgentSpecDto {
  key: string;
  label_i18n: string;
  models: string[];
  default_model: string | null;
  supports_model: boolean;
  needs_local_verify: boolean;
}

// 對齊後端 BrainTestResult（POST /settings/brain/test）。
export interface BrainTestResult {
  ok: boolean;
  provider: string;
  model: string | null;
  elapsedMs: number;
  sample: string;
  error: string | null;
}

interface BrainTestResultDto {
  ok: boolean;
  provider: string;
  model: string | null;
  elapsed_ms: number;
  sample: string;
  error: string | null;
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
  if (changes.cliModel !== undefined) body.cli_model = changes.cliModel;
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

/** 取得 CLI 代理註冊表（前端動態建 agent／model 選單）。 */
export async function fetchBrainAgents(
  signal?: AbortSignal,
): Promise<BrainAgentSpec[]> {
  const res = await fetch(`${API_BASE}/settings/brain/agents`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`brain agents API ${res.status}`);
  const data = (await res.json()) as { agents: BrainAgentSpecDto[] };
  return data.agents.map((a) => ({
    key: a.key,
    labelI18n: a.label_i18n,
    models: a.models,
    defaultModel: a.default_model,
    supportsModel: a.supports_model,
    needsLocalVerify: a.needs_local_verify,
  }));
}

/**
 * 以候選（未存）設定做煙測。HTTP 恆 200，以 ok 區分成功／失敗。
 * BYOK 金鑰仍由後端 .env 取得（body 不帶）。
 */
export async function testBrainConfig(
  candidate: BrainConfigUpdate & { provider: BrainProvider },
  signal?: AbortSignal,
): Promise<BrainTestResult> {
  const body: Record<string, unknown> = { provider: candidate.provider };
  if (candidate.ollamaModel != null) body.ollama_model = candidate.ollamaModel;
  if (candidate.cliAgent != null) body.cli_agent = candidate.cliAgent;
  if (candidate.cliModel != null) body.cli_model = candidate.cliModel;
  if (candidate.byokProtocol != null)
    body.byok_protocol = candidate.byokProtocol;
  if (candidate.byokBaseUrl != null) body.byok_base_url = candidate.byokBaseUrl;
  if (candidate.byokModel != null) body.byok_model = candidate.byokModel;

  const res = await fetch(`${API_BASE}/settings/brain/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`brain test API ${res.status}`);
  const dto = (await res.json()) as BrainTestResultDto;
  return {
    ok: dto.ok,
    provider: dto.provider,
    model: dto.model,
    elapsedMs: dto.elapsed_ms,
    sample: dto.sample,
    error: dto.error,
  };
}
