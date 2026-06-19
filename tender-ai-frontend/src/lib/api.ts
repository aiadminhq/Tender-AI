// 後端 API 對接：抓真實標案，映射成前端 Tender 契約。
// 失敗（後端未啟動／網路錯誤）時拋出，由呼叫端 fallback 回 mock。
import type {
  Category,
  CategorySignal,
  CriteriaProfile,
  FilterState,
  ReasonCode,
  SavedSearch,
  SourceKey,
  Tender,
  TenderDetail,
  TenderReasoning,
  Tier,
} from "@/types/domain";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1";

// 選用 API 金鑰：設定 VITE_API_KEY 時帶上 X-API-Key（dev/staging 可不設）。
// 金鑰僅由環境注入，永不寫入版控。
function authHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  return key ? { "X-API-Key": key } : {};
}

// 後端 TenderListItem（app/schemas/tender.py）對應欄位。
interface TenderListItem {
  id: number;
  source: string;
  case_pk: string | null;
  name: string;
  org: string | null;
  category: string | null;
  budget_wan: number | null;
  deadline_roc: string | null;
  deadline_iso: string | null;
  tender_method: string | null;
  city: string | null;
  link: string | null;
  tier: string | null;
  days_left: number | null;
  first_seen: string | null;
  last_seen: string | null;
  // SL2 後端學習可行度（0–100）；冷啟動退化為 tier 推導。舊後端無此欄 → null。
  feasibility_score: number | null;
}
interface TenderListResponse {
  items: TenderListItem[];
  count: number;
  page: number;
  page_size: number;
}

// 後端 SnapshotItem / UserStateOut / TenderDetail（= 列表項 + 快照 + 使用者狀態）。
interface SnapshotItem {
  run_date: string;
  tier: string | null;
  days_left: number | null;
}
interface UserStateOut {
  saved: boolean;
  status: string | null;
  star: number | null;
}
interface TenderDetailResponse extends TenderListItem {
  snapshots: SnapshotItem[];
  user_state: UserStateOut | null;
}

const SOURCE_KEYS: SourceKey[] = ["PCC", "TMU", "TPC", "NPC"];
function toSource(s: string | null): SourceKey {
  const up = (s ?? "").toUpperCase();
  return (SOURCE_KEYS as string[]).includes(up) ? (up as SourceKey) : "PCC";
}

function toTier(t: string | null): Tier {
  const v = (t ?? "").trim().toLowerCase();
  if (v === "high" || t === "高") return "high";
  if (v === "low" || t === "低") return "low";
  return "mid";
}

// 後端 category 目前多為 null（爬蟲未填）→ 以標案名稱啟發式回推，
// 對齊業務優先序（工程 > 財物 > 勞務）。
function toCategory(c: string | null, name = ""): Category {
  const v = c ?? "";
  if (v.includes("工程")) return "works";
  if (v.includes("財物")) return "goods";
  if (v.includes("勞務")) return "services";
  if (/工程|修繕|整修|汰換|裝修|施工|改善|拆除|防水/.test(name)) return "works";
  if (/採購|設備|供應|財物|器材|傢俱|家具/.test(name)) return "goods";
  return "services";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// 分數合成（P5 前的暫代）：沿用 prototype 區間 ≤14 高 / 15–30 中 / ≥31 低，
// 以 tier 為基底、days_left 微調，越小越高潛力。
function synthScore(tier: Tier, daysLeft: number | null): number {
  const d = daysLeft ?? 30;
  if (tier === "high") return 6 + clamp(d, 0, 8);
  if (tier === "mid") return 16 + clamp(d, 0, 14);
  return 32 + clamp(d, 0, 40);
}

// 供應商覆蓋：P5 前以 tier 衍生佔位。可行度改用後端 SL2 學習分數
// （見 adapt()）；FEAS_BY_TIER 僅在後端未回傳 feasibility_score 時當 fallback。
const FEAS_BY_TIER: Record<Tier, number> = { high: 85, mid: 65, low: 40 };
const COVER_BY_TIER: Record<Tier, number> = { high: 88, mid: 66, low: 42 };

function adapt(item: TenderListItem): Tender {
  const tier = toTier(item.tier);
  return {
    id: String(item.id),
    title: item.name,
    org: item.org ?? "",
    source: toSource(item.source),
    budget: (item.budget_wan ?? 0) * 10000, // 萬元 → TWD
    deadline: item.deadline_iso ?? "",
    publishedAt: item.first_seen ?? item.deadline_iso ?? "",
    tier,
    score: synthScore(tier, item.days_left),
    // SL2：優先採用後端學習可行度；缺值（舊後端／mock）退回 tier 佔位。
    feasibility: Math.round(item.feasibility_score ?? FEAS_BY_TIER[tier]),
    supplierCoverage: COVER_BY_TIER[tier],
    category: toCategory(item.category, item.name),
    tags: [], // 關鍵字命中於 P4 學習迴圈後補；focus/exclude 仍會比對標題
    // ── 後端額外欄位（live 才有）：詳情頁／抽屜用，null → undefined ──
    caseNo: item.case_pk ?? undefined,
    tenderMethod: item.tender_method ?? undefined,
    link: item.link ?? undefined,
    deadlineRoc: item.deadline_roc ?? undefined,
    city: item.city ?? undefined,
    lastSeen: item.last_seen ?? undefined,
  };
}

function adaptDetail(item: TenderDetailResponse): TenderDetail {
  return {
    ...adapt(item),
    snapshots: (item.snapshots ?? []).map((s) => ({
      runDate: s.run_date,
      tier: s.tier ? toTier(s.tier) : null,
      daysLeft: s.days_left,
    })),
    userState: item.user_state
      ? {
          saved: item.user_state.saved,
          status: item.user_state.status,
          star: item.user_state.star,
        }
      : null,
  };
}

const PAGE_SIZE = 200; // 後端 page_size 上限

/** 抓取標案列表並映射為前端 Tender[]；逐頁抓到 count 為止。失敗時 throw。 */
export async function fetchTenders(signal?: AbortSignal): Promise<Tender[]> {
  const items: TenderListItem[] = [];
  let page = 1;
  for (;;) {
    const url = `${API_BASE}/tenders?sort=feas&page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: authHeaders(), signal });
    if (!res.ok) throw new Error(`tenders API ${res.status}`);
    const data = (await res.json()) as TenderListResponse;
    items.push(...data.items);
    // 取滿總數或遇到空頁即停（後者防呆，避免 count 與實際不一致時無限迴圈）。
    if (items.length >= data.count || data.items.length === 0) break;
    page += 1;
  }
  return items.map(adapt);
}

/** 抓取單一標案完整詳情（含歷史快照）；找不到回 null，其餘錯誤 throw。 */
export async function fetchTenderDetail(
  id: string,
  signal?: AbortSignal,
): Promise<TenderDetail | null> {
  const url = `${API_BASE}/tenders/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tender detail API ${res.status}`);
  const data = (await res.json()) as TenderDetailResponse;
  return adaptDetail(data);
}

// 後端 SemanticHit（app/schemas/search.py）= 列表項 + 與查詢向量的距離／相似度。
interface SemanticHit extends TenderListItem {
  distance: number; // cosine 距離（0=完全相同，越小越近）
  score: number; // 1-distance，clamp[0,1]，越大越相似
}

/** RAG 相似案：標案 + 相似度分數（0..1，越大越相似）。 */
export interface SimilarTender {
  tender: Tender;
  score: number;
}

/**
 * 抓取與指定標案語意相近的標案（Layer C 向量檢索）。
 * 後端 GET /search/similar/{id}?limit=；失敗時 throw，由呼叫端決定如何呈現。
 * 前端再保險濾除標案自身（後端通常已排除）。
 */
export async function fetchSimilarTenders(
  id: string,
  limit = 6,
  signal?: AbortSignal,
): Promise<SimilarTender[]> {
  const url = `${API_BASE}/search/similar/${encodeURIComponent(id)}?limit=${limit}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (!res.ok) throw new Error(`similar API ${res.status}`);
  const data = (await res.json()) as SemanticHit[];
  return data
    .filter((h) => String(h.id) !== id)
    .map((h) => ({ tender: adapt(h), score: h.score }));
}

// ── SL3 意圖與推理（Layer A 唯讀；後端 app/api/v1/reasoning.py） ──────
// 後端回傳 snake_case，這裡映射成前端 camelCase 契約（見 types/domain.ts）。
interface ReasonCodeRaw {
  factor: string;
  label: string;
  value: string | null;
  direction: ReasonCode["direction"];
  impact: number;
  evidence: string;
}
interface CategorySignalRaw {
  value: string;
  p_feasible: number;
  lift: number;
  support: number;
  feasible: number;
  infeasible: number;
}
interface CriteriaProfileRaw {
  n_evaluations: number;
  n_events: number;
  base_rate: number;
  category_signals: CategorySignalRaw[];
  city_signals: CategorySignalRaw[];
  source_signals: CategorySignalRaw[];
  budget_feasible_min: number | null;
  budget_feasible_max: number | null;
  budget_feasible_median: number | null;
  top_keywords_positive: string[];
  top_keywords_negative: string[];
  engaged_categories: string[];
  engaged_cities: string[];
  summary: string;
  confidence: CriteriaProfile["confidence"];
}
interface TenderReasoningRaw {
  tender_id: number;
  criteria_fit: number;
  verdict: TenderReasoning["verdict"];
  headline: string;
  reasons: ReasonCodeRaw[];
  profile: CriteriaProfileRaw;
}

function adaptSignal(s: CategorySignalRaw): CategorySignal {
  return {
    value: s.value,
    pFeasible: s.p_feasible,
    lift: s.lift,
    support: s.support,
    feasible: s.feasible,
    infeasible: s.infeasible,
  };
}

function adaptProfile(p: CriteriaProfileRaw): CriteriaProfile {
  return {
    nEvaluations: p.n_evaluations,
    nEvents: p.n_events,
    baseRate: p.base_rate,
    categorySignals: (p.category_signals ?? []).map(adaptSignal),
    citySignals: (p.city_signals ?? []).map(adaptSignal),
    sourceSignals: (p.source_signals ?? []).map(adaptSignal),
    budgetFeasibleMin: p.budget_feasible_min,
    budgetFeasibleMax: p.budget_feasible_max,
    budgetFeasibleMedian: p.budget_feasible_median,
    topKeywordsPositive: p.top_keywords_positive ?? [],
    topKeywordsNegative: p.top_keywords_negative ?? [],
    engagedCategories: p.engaged_categories ?? [],
    engagedCities: p.engaged_cities ?? [],
    summary: p.summary,
    confidence: p.confidence,
  };
}

/**
 * 抓取單一標案的「為什麼·推理」（SL3）：可中標 fit、結論、逐條 reason code、
 * 與推理所依據的判準輪廓快照。後端 GET /tenders/{id}/reasoning。
 * 404 回 null（標案不存在）；其餘錯誤 throw，由呼叫端決定如何呈現。
 */
export async function fetchTenderReasoning(
  id: string,
  signal?: AbortSignal,
): Promise<TenderReasoning | null> {
  const url = `${API_BASE}/tenders/${encodeURIComponent(id)}/reasoning`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reasoning API ${res.status}`);
  const d = (await res.json()) as TenderReasoningRaw;
  return {
    tenderId: d.tender_id,
    criteriaFit: d.criteria_fit,
    verdict: d.verdict,
    headline: d.headline,
    reasons: (d.reasons ?? []).map((r) => ({ ...r })),
    profile: adaptProfile(d.profile),
  };
}

// ── 行為回寫（Layer B 共享學習迴圈，fire-and-forget） ──────────────
// 後端 app/api/v1/behavior.py。Layer B 在白名單(@hqdesign.tw)合作範圍內共享，
// 供同事與 AI/agent 互相學習。現行 demo 尚未建登入，故暫時省略 user_id（後端
// 落到預設使用者）；目標模型為白名單登入後帶 user_id 並依登入帳號具名（見 CLAUDE.md）。
// localStorage 仍是前端真相來源，後端僅作學習匯入：失敗靜默、不阻塞 UI、不回滾。
async function postBehavior(path: string, body: unknown): Promise<void> {
  if (import.meta.env.VITE_USE_API === "false") return; // 純 mock 模式不外連
  try {
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    /* 盡力寫入，失敗不影響前端狀態 */
  }
}

/** 收藏／取消收藏 → POST /tenders/{id}/save。 */
export function postSave(id: string, saved: boolean): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/save`, { saved });
}

/** 承接（status 預設備標中）／略過（放棄）→ POST /tenders/{id}/accept。 */
export function postAccept(id: string, status: string): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/accept`, { status });
}

/** 加註記 → POST /tenders/{id}/note。 */
export function postNote(id: string, note: string): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/note`, { note });
}

/** 評價（後端 star 1..5）→ POST /tenders/{id}/rate。理由欄由前端 localStorage 佔位（後端 rationale 待 ticket）。 */
export function postRate(id: string, star: number): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/rate`, { star });
}

/** 轉發 → POST /tenders/{id}/share。channel = link/email。 */
export function postShare(id: string, channel: string): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/share`, { channel });
}

// ── saved-searches（篩選預設；非 fire-and-forget，UI 需要回傳資料） ──────
// 後端 app/api/v1/behavior.py，掛在 /api/v1 下。現行 demo 暫省略 user_id（目標：白名單登入後具名，見 CLAUDE.md）。
interface SavedSearchOut {
  id: number;
  user_id: number;
  name: string;
  query_text: string | null;
  filter_json: FilterState | null;
  created_at: string;
}

function adaptSavedSearch(o: SavedSearchOut): SavedSearch {
  return {
    id: o.id,
    name: o.name,
    // filter_json 由前端自家寫入，型別即 FilterState；缺值給空查詢防呆。
    filter: o.filter_json ?? ({} as FilterState),
  };
}

/** 讀取雲端篩選預設（GET /saved-searches）。純 mock 模式回 []；失敗時 throw。 */
export async function fetchSavedSearches(
  signal?: AbortSignal,
): Promise<SavedSearch[]> {
  if (import.meta.env.VITE_USE_API === "false") return [];
  const res = await fetch(`${API_BASE}/saved-searches`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`saved-searches API ${res.status}`);
  const data = (await res.json()) as SavedSearchOut[];
  return data.map(adaptSavedSearch);
}

/** 建立篩選預設（POST /saved-searches）。純 mock 模式回 null；失敗時 throw。 */
export async function postSavedSearch(
  name: string,
  filter: FilterState,
): Promise<SavedSearch | null> {
  if (import.meta.env.VITE_USE_API === "false") return null;
  const res = await fetch(`${API_BASE}/saved-searches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      name,
      query_text: filter.query || null,
      filter_json: filter,
    }),
  });
  if (!res.ok) throw new Error(`saved-searches API ${res.status}`);
  return adaptSavedSearch((await res.json()) as SavedSearchOut);
}
