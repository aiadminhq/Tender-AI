// 後端 API 對接：抓真實標案，映射成前端 Tender 契約。
// 失敗（後端未啟動／網路錯誤）時拋出，由呼叫端 fallback 回 mock。
import { getToken } from "@/lib/auth-token";
import type {
  Category,
  CategorySignal,
  CriteriaProfile,
  FilterState,
  ReasonCode,
  SavedSearch,
  SourceKey,
  StructuredItem,
  Tender,
  TenderAttachment,
  TenderDetail,
  TenderReasoning,
  TenderRevisionDetail,
  Tier,
} from "@/types/domain";

const configuredApiBase = import.meta.env.VITE_API_BASE as string | undefined;
const API_BASE =
  // Vercel 的 root vercel.json 已把 Python function 與 SPA 部署在同一專案；
  // production 必須走同源 API，避免殘留的 Railway URL 讓畫面讀到舊分頁／資料集。
  import.meta.env.PROD ? "/api/v1" : (configuredApiBase ?? "/api/v1");

// 選用 API 金鑰：設定 VITE_API_KEY 時帶上 X-API-Key（dev/staging 可不設）。
// Phase 2：有 Bearer token 時一併帶上 Authorization header。
// 金鑰僅由環境注入，永不寫入版控。
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  if (key) headers["X-API-Key"] = key;
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ── 登入身分（Layer B 具名回寫） ─────────────────────────────────────
// 白名單帳號登入後，由 AuthProvider 呼叫 setCurrentUserId 注入 user_id；
// 行為回寫（save/rate/note/share）與篩選預設即帶上此 id，依登入帳號「具名」
// 進入合作範圍內共享的學習迴圈。仍受後端兩段式同意把關：consent_shared=False
// 時後端不匯入共享庫，故具名回寫不違反對外隔離邊界（見 CLAUDE.md）。
// 示範模式／後端不可達退化登入時維持 null，後端落到預設使用者（不具名）。
let currentUserId: number | null = null;

/** 設定（或清除）目前登入帳號的 user_id；null＝未具名（示範／退化）。 */
export function setCurrentUserId(id: number | null): void {
  currentUserId = id;
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
  // cursor（keyset）真分頁：下一頁的不透明游標；無下一頁為 null。舊後端無此欄 → undefined。
  next_cursor?: string | null;
}

/** 單頁抓取結果：已映射的 Tender[]、總數、下一頁游標（無則 null）。 */
export interface TenderPage {
  tenders: Tender[];
  count: number;
  nextCursor: string | null;
}

/** 下推到後端 cursor 分頁的「硬篩選」（精確集合比對，語意與前端一致、無單位歧義）。
 *
 * 僅這三欄下推：src/tier/cat 皆比對後端與前端共用的同一 API 欄位（source/derived tier/
 * category），server 端過濾與前端 memo 完全等價 → 結果集不變，但分頁改在「篩選後的集合」
 * 內連貫（載入更多才會續抓仍符合條件的列，而非沿 feas 抓未篩選頁再被前端濾掉）。
 * budget（萬/TWD 單位歧義）、deadline/q（語意不同）、sort（前端以即時 feasOf 排序）
 * 一律維持前端處理，不下推，以免 server 端多濾而誤刪前端本應保留的列。 */
export interface TenderPageFilter {
  sources?: string[];
  tiers?: string[];
  categories?: string[];
}

/** 把前端 filter 投影成「可安全下推」的三欄；皆空時回 undefined（等同不帶 server 篩選）。 */
export function toServerFilter(f: {
  sources?: string[];
  tiers?: string[];
  categories?: string[];
}): TenderPageFilter | undefined {
  const sf: TenderPageFilter = {};
  if (f.sources?.length) sf.sources = f.sources;
  if (f.tiers?.length) sf.tiers = f.tiers;
  if (f.categories?.length) sf.categories = f.categories;
  return Object.keys(sf).length ? sf : undefined;
}

/** server-filter 穩定指紋：三欄排序後串接，供偵測「篩選是否變動→需重取第一頁」。 */
export function serverFilterKey(sf: TenderPageFilter | undefined): string {
  if (!sf) return "";
  const part = (xs?: string[]) => (xs ? [...xs].sort().join(",") : "");
  return `t=${part(sf.tiers)}|c=${part(sf.categories)}|s=${part(sf.sources)}`;
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
// 後端 AttachmentItem / RevisionDetail（app/schemas/tender.py）；未 enrich 時 revision 為 null。
interface AttachmentItemRaw {
  filename: string | null;
  url: string | null;
  archived: boolean;
  skipped: boolean | null;
  error: string | null;
}
interface StructuredItemRaw {
  kind: string;
  label: string | null;
  content: string;
  params?: Record<string, unknown>;
}
interface RevisionDetailRaw {
  revision_no: number;
  fetched_at: string | null;
  award_method: string | null;
  deposit_required: boolean | null;
  deposit_amount_twd: number | null;
  deposit_raw_text: string | null;
  qualification_codes: string[];
  qualification_text: string | null;
  qualification_items?: StructuredItemRaw[];
  category_main: string | null;
  category_name: string | null;
  category_raw: string | null;
  performance_period: string | null;
  performance_location: string | null;
  subsidy_source: string | null;
  extra_note: string | null;
  attachments: AttachmentItemRaw[];
}
interface TenderDetailResponse extends TenderListItem {
  snapshots: SnapshotItem[];
  user_state: UserStateOut | null;
  revision: RevisionDetailRaw | null;
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

/** PCC 舊資料可能把純數字案號存成 base64 token；只在可安全解成數字時轉為顯示值。 */
export function displayCaseNo(
  casePk: string | null,
  source: SourceKey,
): string | undefined {
  const raw = casePk?.trim();
  if (!raw) return undefined;
  if (source !== "PCC" || /^\d+$/.test(raw)) return raw;
  try {
    const decoded = globalThis.atob(raw).trim();
    return /^\d+$/.test(decoded) ? decoded : raw;
  } catch {
    return raw;
  }
}

function adapt(item: TenderListItem): Tender {
  const tier = toTier(item.tier);
  const source = toSource(item.source);
  return {
    id: String(item.id),
    title: item.name,
    org: item.org ?? "",
    source,
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
    caseNo: displayCaseNo(item.case_pk, source),
    tenderMethod: item.tender_method ?? undefined,
    link: item.link ?? undefined,
    deadlineRoc: item.deadline_roc ?? undefined,
    city: item.city ?? undefined,
    lastSeen: item.last_seen ?? undefined,
  };
}

function adaptAttachment(a: AttachmentItemRaw): TenderAttachment {
  return {
    filename: a.filename,
    url: a.url,
    archived: a.archived,
    skipped: a.skipped,
    error: a.error,
  };
}

function adaptStructuredItem(it: StructuredItemRaw): StructuredItem {
  return {
    kind: it.kind,
    label: it.label,
    content: it.content,
    params: it.params ?? {},
  };
}

function adaptRevision(r: RevisionDetailRaw): TenderRevisionDetail {
  return {
    revisionNo: r.revision_no,
    fetchedAt: r.fetched_at,
    awardMethod: r.award_method,
    depositRequired: r.deposit_required,
    depositAmountTwd: r.deposit_amount_twd,
    depositRawText: r.deposit_raw_text,
    qualificationCodes: r.qualification_codes ?? [],
    qualificationText: r.qualification_text,
    qualificationItems: (r.qualification_items ?? []).map(adaptStructuredItem),
    categoryMain: r.category_main,
    categoryName: r.category_name,
    categoryRaw: r.category_raw,
    performancePeriod: r.performance_period,
    performanceLocation: r.performance_location,
    subsidySource: r.subsidy_source,
    extraNote: r.extra_note,
    attachments: (r.attachments ?? []).map(adaptAttachment),
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
    revision: item.revision ? adaptRevision(item.revision) : null,
  };
}

const PAGE_SIZE = 200; // 後端 page_size 上限

/** 抓取標案清單的「一頁」（cursor keyset 真分頁）。
 *
 * 傳入 cursor=null 取第一頁；後續把上一頁回傳的 nextCursor 再帶回即可續抓。
 * 排序固定 feas；換排序/篩選時 cursor 會失效（後端回 400），呼叫端應以 null 重取第一頁。
 * filter：可選的 server-filter（src/tier/cat），會下推到後端讓分頁在篩選集內連貫；
 * 續抓同一游標時務必帶「相同」filter（否則游標與篩選集不一致）。失敗時 throw。 */
export async function fetchTenderPage(
  cursor: string | null = null,
  signal?: AbortSignal,
  filter?: TenderPageFilter,
): Promise<TenderPage> {
  const params = new URLSearchParams({
    sort: "feas",
    page_size: String(PAGE_SIZE),
  });
  if (cursor) params.set("cursor", cursor);
  // 後端以多值 Query 接收（tier/cat/src）；逐一 append 成重複鍵。
  for (const v of filter?.tiers ?? []) params.append("tier", v);
  for (const v of filter?.categories ?? []) params.append("cat", v);
  for (const v of filter?.sources ?? []) params.append("src", v);
  const url = `${API_BASE}/tenders?${params.toString()}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (!res.ok) throw new Error(`tenders API ${res.status}`);
  const data = (await res.json()) as TenderListResponse;
  return {
    tenders: data.items.map(adapt),
    count: data.count,
    nextCursor: data.next_cursor ?? null,
  };
}

/** 抓取標案列表並映射為前端 Tender[]；沿 cursor 逐頁抓到底為止。失敗時 throw。 */
export async function fetchTenders(signal?: AbortSignal): Promise<Tender[]> {
  const all: Tender[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await fetchTenderPage(cursor, signal);
    all.push(...page.tenders);
    // 無下一頁游標，或本頁為空（防呆）即停。
    if (!page.nextCursor || page.tenders.length === 0) break;
    cursor = page.nextCursor;
  }
  return all;
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

// 後端 SimilarDecisionHit / DecisionRecommendation（app/schemas/search.py，P5）。
// 僅帶結論標籤（可行/不可行），不外洩 rationale 全文或使用者身分（隱私鐵則）。
interface SimilarDecisionHitRaw extends TenderListItem {
  distance: number;
  score: number;
  feasible: string; // 該相似案結論：可行 | 不可行
}
interface DecisionRecommendationRaw {
  tender_id: number;
  verdict: string; // feasible_leaning | infeasible_leaning | unknown
  confidence: number;
  feasible_count: number;
  infeasible_count: number;
  headline: string;
  neighbors: SimilarDecisionHitRaw[];
}

/** 承接傾向結論：偏可行／偏不可行／資料不足。 */
export type DecisionVerdict =
  | "feasible_leaning"
  | "infeasible_leaning"
  | "unknown";

/** 決策推薦的單一相似已評估案例（標案 + 距離/分數 + 結論標籤）。 */
export interface DecisionNeighbor {
  tender: Tender;
  distance: number;
  score: number;
  feasible: string; // 可行 | 不可行
}

/** 決策推薦（P5）：聚合相似已評估案例給候選標案一個可解釋的承接傾向。 */
export interface DecisionRecommendation {
  tenderId: number;
  verdict: DecisionVerdict;
  confidence: number; // [0,1]
  feasibleCount: number;
  infeasibleCount: number;
  headline: string;
  neighbors: DecisionNeighbor[];
}

/**
 * 抓取候選標案的「承接傾向」決策推薦（P5）。後端 GET /search/recommend/{id}?limit=。
 * 以相似的已評估案例（決策向量）聚合出偏可行／偏不可行的傾向與可解釋鄰居。
 * 失敗時 throw（需後端與決策向量庫），由呼叫端優雅退化（不顯示此區塊）。
 */
export async function fetchDecisionRecommendation(
  id: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<DecisionRecommendation> {
  const url = `${API_BASE}/search/recommend/${encodeURIComponent(id)}?limit=${limit}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (!res.ok) throw new Error(`recommend API ${res.status}`);
  const d = (await res.json()) as DecisionRecommendationRaw;
  return {
    tenderId: d.tender_id,
    verdict: (["feasible_leaning", "infeasible_leaning"].includes(d.verdict)
      ? d.verdict
      : "unknown") as DecisionVerdict,
    confidence: d.confidence,
    feasibleCount: d.feasible_count,
    infeasibleCount: d.infeasible_count,
    headline: d.headline,
    neighbors: (d.neighbors ?? []).map((n) => ({
      tender: adapt(n),
      distance: n.distance,
      score: n.score,
      feasible: n.feasible,
    })),
  };
}

/** 語意搜尋結果：原始查詢回放 + 命中（標案 + 相似度分數，已依分數遞減排序）。 */
export interface SemanticSearchResult {
  query: string;
  items: SimilarTender[];
}

/**
 * 語意檢索離線降級：向量後端（Ollama）不可用時後端回 503 + code=semantic_degraded。
 * 呼叫端據此顯示「語意搜尋離線降級」狀態，而非與真實錯誤混淆（見 roadmap P2-6）。
 */
export class SemanticDegradedError extends Error {
  constructor(detail?: string) {
    super(detail ?? "semantic_degraded");
    this.name = "SemanticDegradedError";
  }
}

/**
 * 自然語言語意搜尋（Layer C 向量檢索）。後端 GET /search/semantic?q=&limit=。
 * 以查詢字串向量化後比對 tender_snapshots.embedding，回傳語意最相近的標案。
 * 向量後端不可用時 throw SemanticDegradedError（離線降級）；其餘錯誤 throw Error，
 * 由呼叫端分別呈現。
 */
export async function searchSemantic(
  q: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<SemanticSearchResult> {
  const url = `${API_BASE}/search/semantic?q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (!res.ok) {
    if (res.status === 503) {
      const body = await res.json().catch(() => null);
      if (body?.code === "semantic_degraded") {
        throw new SemanticDegradedError(body?.detail);
      }
    }
    throw new Error(`semantic search API ${res.status}`);
  }
  const data = (await res.json()) as {
    items: SemanticHit[];
    count: number;
    query: string;
  };
  return {
    query: data.query,
    items: (data.items ?? []).map((h) => ({
      tender: adapt(h),
      score: h.score,
    })),
  };
}

// ── SL6 自我進化（Layer A 聚合，唯讀＋手動觸發；後端 app/api/v1/learning.py） ──
// status/run 對外只回聚合統計與公開衍生詞彙，不含人名／email／個別評語原文。
interface TermWeightRaw {
  term: string;
  weight: number;
  support: number;
}
interface EvolutionLogRaw {
  id: number;
  batch: string;
  trigger: string;
  feasible_samples: number;
  infeasible_samples: number;
  keywords_added: number;
  keywords_updated: number;
  revision_rows: number;
  top_positive: TermWeightRaw[];
  top_negative: TermWeightRaw[];
  created_at: string | null;
}
interface EvolutionStatusRaw {
  total_runs: number;
  latest: EvolutionLogRaw | null;
  history: EvolutionLogRaw[];
  active_positive: TermWeightRaw[];
  active_negative: TermWeightRaw[];
}

/** 判準詞彙（重點詞／避免詞）：詞 + 權重 + 支持樣本數。 */
export interface EvoTermWeight {
  term: string;
  weight: number;
  support: number;
}
/** 一次進化迭代的稽核摘要（camelCase 前端契約）。 */
export interface EvolutionLog {
  id: number;
  batch: string;
  trigger: string;
  feasibleSamples: number;
  infeasibleSamples: number;
  keywordsAdded: number;
  keywordsUpdated: number;
  revisionRows: number;
  topPositive: EvoTermWeight[];
  topNegative: EvoTermWeight[];
  createdAt: string | null;
}
/** 進化現況：總次數 + 最新日誌 + 歷史時間軸 + 當前生效權重。 */
export interface EvolutionStatus {
  totalRuns: number;
  latest: EvolutionLog | null;
  history: EvolutionLog[];
  activePositive: EvoTermWeight[];
  activeNegative: EvoTermWeight[];
}

function adaptEvolutionLog(l: EvolutionLogRaw): EvolutionLog {
  return {
    id: l.id,
    batch: l.batch,
    trigger: l.trigger,
    feasibleSamples: l.feasible_samples,
    infeasibleSamples: l.infeasible_samples,
    keywordsAdded: l.keywords_added,
    keywordsUpdated: l.keywords_updated,
    revisionRows: l.revision_rows,
    topPositive: l.top_positive ?? [],
    topNegative: l.top_negative ?? [],
    createdAt: l.created_at,
  };
}

/** 讀取自我進化現況（GET /evolution/status）。失敗時 throw（需後端）。 */
export async function fetchEvolutionStatus(
  historyLimit = 10,
  signal?: AbortSignal,
): Promise<EvolutionStatus> {
  const url = `${API_BASE}/evolution/status?history_limit=${historyLimit}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (!res.ok) throw new Error(`evolution status API ${res.status}`);
  const d = (await res.json()) as EvolutionStatusRaw;
  return {
    totalRuns: d.total_runs,
    latest: d.latest ? adaptEvolutionLog(d.latest) : null,
    history: (d.history ?? []).map(adaptEvolutionLog),
    activePositive: d.active_positive ?? [],
    activeNegative: d.active_negative ?? [],
  };
}

/** 手動跑一輪自我進化（POST /evolution/run，trigger=manual）。回傳該筆稽核日誌；失敗時 throw。 */
export async function runEvolution(
  minSupport = 2,
  signal?: AbortSignal,
): Promise<EvolutionLog> {
  const res = await fetch(`${API_BASE}/evolution/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ trigger: "manual", min_support: minSupport }),
    signal,
  });
  if (!res.ok) throw new Error(`evolution run API ${res.status}`);
  return adaptEvolutionLog((await res.json()) as EvolutionLogRaw);
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

/**
 * 抓取操作者的「判準輪廓」（SL3）：系統從過往可行／不可行評估學到的承標偏好，
 * 不綁定單一標案，供洞察分析就地標註各維度訊號。後端 GET /reasoning/profile。
 * 非 200（含未啟動／無資料）一律回 null，由呼叫端優雅退化（不顯示學習訊號）。
 */
export async function fetchReasoningProfile(
  signal?: AbortSignal,
): Promise<CriteriaProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/reasoning/profile`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    return adaptProfile((await res.json()) as CriteriaProfileRaw);
  } catch {
    return null; // 後端未啟動／網路錯誤 → 退化為無學習訊號
  }
}

// ── 速覽配對判斷原因表單：關鍵字候選（唯讀；後端 GET /tenders/{id}/keyword-candidates） ──
// C 需求：把相關關鍵字拆「字（CJK 單字）／詞（jieba 斷詞）」供本人選取，標註「因哪些
// 關鍵字而做此判斷」。recommended_negative 僅為系統建議（附 lift／reason），真正歸負分
// 唯有本人在表單按確認後走 postKeywordOverride(kind="negative")（負分人工專屬紅線）。
export interface KeywordToken {
  term: string;
  inTitle: boolean; // 出現在標案名稱（vs 僅出現在機關）
}
export interface NegativeCandidate {
  term: string;
  lift: number;
  reason: string;
}
export interface KeywordCandidates {
  tenderId: number;
  title: string;
  org: string | null;
  words: KeywordToken[]; // jieba 斷詞（詞）
  chars: KeywordToken[]; // CJK 單字（字）
  positiveHits: string[]; // ✓/⭐ 預選：本人學習正向詞 ∩ 本標案文字
  recommendedNegative: NegativeCandidate[]; // ✗ 預選但需人確認：系統建議
}
interface KeywordTokenRaw {
  term: string;
  in_title: boolean;
}
interface KeywordCandidatesRaw {
  tender_id: number;
  title: string;
  org: string | null;
  words: KeywordTokenRaw[];
  chars: KeywordTokenRaw[];
  positive_hits: string[];
  recommended_negative: { term: string; lift: number; reason: string }[];
}

/**
 * 抓取某標案的字／詞候選＋正向命中＋系統負向建議（速覽判斷原因表單用）。
 * 後端唯讀、離線、不寫任何權重。404（標案不存在）回 null；其餘錯誤 throw。
 */
export async function fetchKeywordCandidates(
  id: string,
  signal?: AbortSignal,
): Promise<KeywordCandidates | null> {
  const q = currentUserId == null ? "" : `?user_id=${currentUserId}`;
  const url = `${API_BASE}/tenders/${encodeURIComponent(id)}/keyword-candidates${q}`;
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`keyword-candidates API ${res.status}`);
  const d = (await res.json()) as KeywordCandidatesRaw;
  return {
    tenderId: d.tender_id,
    title: d.title,
    org: d.org,
    words: (d.words ?? []).map((w) => ({ term: w.term, inTitle: w.in_title })),
    chars: (d.chars ?? []).map((c) => ({ term: c.term, inTitle: c.in_title })),
    positiveHits: d.positive_hits ?? [],
    recommendedNegative: (d.recommended_negative ?? []).map((c) => ({
      term: c.term,
      lift: c.lift,
      reason: c.reason,
    })),
  };
}

// ── 規則頁「建議迴避字根」：由本人淘汰過的標案聚合（唯讀；GET /me/abandoned-keyword-candidates） ──
// P3 規則字根連動：把本人**實際淘汰**（速覽 ✗／狀態＝放棄）的標案標題拆字根（2-gram）／詞
// （jieba），跨案做文件頻次統計成候選。附 count／示例標題供人判斷。
// 紅線（negative-keywords-human-only）：此端點唯讀、不寫任何負權重；真正歸負分需本人在規則頁
// 按「加入迴避」走 postKeywordOverride(kind="negative")。
export interface AbandonedRootCandidate {
  term: string;
  kind: "word" | "root"; // word=jieba 斷詞；root=2-gram 字根
  count: number; // 出現在幾件你淘汰的標案（文件頻次）
  sampleTitles: string[]; // 最多 3 筆示例標題
}
export interface AbandonedKeywordCandidates {
  userId: number | null;
  abandonedCount: number; // 納入統計的淘汰標案數
  candidates: AbandonedRootCandidate[];
}
interface AbandonedRootCandidateRaw {
  term: string;
  kind: "word" | "root";
  count: number;
  sample_titles: string[];
}
interface AbandonedKeywordCandidatesRaw {
  user_id: number | null;
  abandoned_count: number;
  candidates: AbandonedRootCandidateRaw[];
}

/**
 * 抓取本人淘汰標案聚合出的「建議迴避字根」候選（規則頁用）。
 * 後端唯讀、離線、不寫任何權重。後端不可達／錯誤時 throw，由呼叫端 fallback。
 */
export async function fetchAbandonedKeywordCandidates(opts?: {
  minCount?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<AbandonedKeywordCandidates> {
  const params = new URLSearchParams();
  if (opts?.minCount != null) params.set("min_count", String(opts.minCount));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const q = params.toString();
  const url = `${API_BASE}/me/abandoned-keyword-candidates${q ? `?${q}` : ""}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal: opts?.signal,
  });
  if (!res.ok)
    throw new Error(`abandoned-keyword-candidates API ${res.status}`);
  const d = (await res.json()) as AbandonedKeywordCandidatesRaw;
  return {
    userId: d.user_id,
    abandonedCount: d.abandoned_count ?? 0,
    candidates: (d.candidates ?? []).map((c) => ({
      term: c.term,
      kind: c.kind,
      count: c.count,
      sampleTitles: c.sample_titles ?? [],
    })),
  };
}

// ── 決策回顧 / 標案評分管理：本人按過星星／打勾／叉叉的處置清單（唯讀；GET /me/tender-decisions） ──
// P4 真資料端點：由 Layer B 行為訊號（速覽 pass 事件、tender_user_state 狀態/收藏/星等）重建
// 三處置：accepted（打勾承接）／starred（星星收藏）／skipped（叉叉淘汰），對齊前端 dispositionOf。
// 供「決策回顧」頁水合後重新檢視存留／淘汰；後端唯讀、不寫任何權重／狀態。
export type DecisionDisposition = "accepted" | "starred" | "skipped";

export interface UserDecision {
  tenderId: string; // 後端 number → String，對齊前端 tender.id
  disposition: DecisionDisposition;
  title: string;
  org: string | null;
  tier: string | null; // high/mid/low/priority；無快照為 null
  deadline: string; // ISO date（YYYY-MM-DD），與 adapt() 的 deadline 一致
  reason: string | null; // 淘汰理由（skipped 才有）
  by: string | null; // 具名貢獻者（登入帳號名）
  at: string | null; // 決策時間（ISO datetime）
}
export interface UserDecisions {
  userId: number | null;
  counts: { accepted: number; starred: number; skipped: number };
  decisions: UserDecision[];
}
interface UserDecisionRaw {
  tender_id: number;
  disposition: DecisionDisposition;
  title: string;
  org: string | null;
  tier: string | null;
  deadline_iso: string | null;
  reason: string | null;
  by: string | null;
  at: string | null;
}
interface UserDecisionsRaw {
  user_id: number | null;
  counts: Record<string, number> | null;
  decisions: UserDecisionRaw[];
}

/**
 * 抓取本人的標案處置清單（決策回顧頁水合用）。
 * 後端唯讀、離線、不寫任何權重／狀態。後端不可達／錯誤時 throw，由呼叫端 fallback。
 */
export async function fetchUserDecisions(opts?: {
  limit?: number;
  signal?: AbortSignal;
}): Promise<UserDecisions> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const q = params.toString();
  const url = `${API_BASE}/me/tender-decisions${q ? `?${q}` : ""}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`tender-decisions API ${res.status}`);
  const d = (await res.json()) as UserDecisionsRaw;
  return {
    userId: d.user_id,
    counts: {
      accepted: d.counts?.accepted ?? 0,
      starred: d.counts?.starred ?? 0,
      skipped: d.counts?.skipped ?? 0,
    },
    decisions: (d.decisions ?? []).map((x) => ({
      tenderId: String(x.tender_id),
      disposition: x.disposition,
      title: x.title,
      org: x.org ?? null,
      tier: x.tier ?? null,
      deadline: x.deadline_iso ?? "",
      reason: x.reason ?? null,
      by: x.by ?? null,
      at: x.at ?? null,
    })),
  };
}

// ── 標案判斷（✓ 可行／✗ 不可行／⭐ 精選）→ Layer B＋即時 B→C 學習 ──────────
// 後端 POST /tenders/{id}/evaluate（app/api/v1/behavior.py）：upsert Evaluation
// ＋發 judgment 事件 → 即時重算關鍵字權重（個人線＋consent-aware 團隊線，append-only）。
// 非 fire-and-forget：UI 需要回傳「已落地的判斷＋本批學習摘要」做就地回饋與排序刷新。
// 「⭐ 精選」＝feasible=可行＋criteria.featured=true（強正向）。
export type FeasibleVerdict = "可行" | "不可行";

export interface JudgmentCriteria {
  chips: string[]; // 選中的原因標籤（快速 chips）
  featured: boolean; // ⭐ 精選旗標
}

/** 本批即時學習摘要（負向已依 2026-06-24 覆寫即時寫團隊負權，append-only）。 */
export interface RealtimeLearning {
  keywordsAdded: number;
  keywordsUpdated: number;
  feasibleSamples: number;
  infeasibleSamples: number;
  consentingUsers: number;
  revisionBatch: string | null;
}

export interface EvaluateResult {
  feasible: FeasibleVerdict | null;
  featured: boolean;
  rationale: string | null;
  learning: RealtimeLearning | null;
}

interface EvaluateResultRaw {
  evaluation: {
    feasible: string | null;
    criteria: { featured?: boolean; chips?: string[] } | null;
    rationale: string | null;
  };
  learning: {
    keywords_added?: number;
    keywords_updated?: number;
    feasible_samples?: number;
    infeasible_samples?: number;
    consenting_users?: number;
    revision_batch?: string | null;
  } | null;
}

/**
 * 送出標案判斷並回傳已落地結果＋本批即時學習摘要。
 * 純 mock 模式回 null；feasible 非 {可行,不可行}→後端 422、未知標案→404，皆 throw。
 */
export async function postEvaluate(
  id: string,
  feasible: FeasibleVerdict,
  rationale: string | null,
  criteria: JudgmentCriteria,
): Promise<EvaluateResult | null> {
  if (import.meta.env.VITE_USE_API === "false") return null;
  const res = await fetch(
    `${API_BASE}/tenders/${encodeURIComponent(id)}/evaluate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        feasible,
        rationale: rationale?.trim() || null,
        criteria,
      }),
    },
  );
  if (!res.ok) throw new Error(`evaluate API ${res.status}`);
  const d = (await res.json()) as EvaluateResultRaw;
  const lr = d.learning;
  return {
    feasible: (d.evaluation?.feasible as FeasibleVerdict | null) ?? null,
    featured: Boolean(d.evaluation?.criteria?.featured),
    rationale: d.evaluation?.rationale ?? null,
    learning: lr
      ? {
          keywordsAdded: lr.keywords_added ?? 0,
          keywordsUpdated: lr.keywords_updated ?? 0,
          feasibleSamples: lr.feasible_samples ?? 0,
          infeasibleSamples: lr.infeasible_samples ?? 0,
          consentingUsers: lr.consenting_users ?? 0,
          revisionBatch: lr.revision_batch ?? null,
        }
      : null,
  };
}

// 後端 PreferenceProfileOut（app/schemas/user.py）：AI 從本人行為學到的個人化偏好。
interface PreferenceProfileRaw {
  top_keywords: string[] | null;
  avoid_keywords: string[] | null;
  preferred_categories: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  updated_at: string | null;
}

/** 個人化偏好輪廓（Layer B，本人專屬）：學到的重點詞／迴避詞／偏好類別／預算區間。 */
export interface PreferenceProfile {
  topKeywords: string[];
  avoidKeywords: string[];
  preferredCategories: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  updatedAt: string | null;
}

/**
 * 抓取本人的「個人化偏好輪廓」（GET /me/preference-profile）。
 * 後端從本人行為學出（衍生表、只讀），尚未學出時回空輪廓（不 404）。
 * 非 200（含未啟動／未登入）一律回 null，由呼叫端優雅退化（不顯示偏好卡）。
 * Layer B：只用本人資料，靠 Bearer token 識別身分（Phase 2）。
 */
export async function fetchPreferenceProfile(
  signal?: AbortSignal,
): Promise<PreferenceProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/me/preference-profile`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    const d = (await res.json()) as PreferenceProfileRaw;
    return {
      topKeywords: d.top_keywords ?? [],
      avoidKeywords: d.avoid_keywords ?? [],
      preferredCategories: d.preferred_categories ?? [],
      budgetMin: d.budget_min,
      budgetMax: d.budget_max,
      updatedAt: d.updated_at,
    };
  } catch {
    return null; // 後端未啟動／網路錯誤 → 退化為無偏好輪廓
  }
}

/**
 * 推理卡手動關鍵字覆寫（Phase 2）：在「為什麼·推理」卡上親手 add／remove 一個
 * 偏好／迴避／常點開的詞。後端 POST /me/keywords，回傳合併覆寫後的最新判準輪廓。
 *
 * kind=negative（迴避）即「負分一律由人手動給」的唯一合規路徑（系統不得自動產生
 * 負分）。個人化線（Layer B）只用本人資料、依登入帳號具名，未登入則落到後端預設
 * 使用者。失敗時 throw，由呼叫端決定如何呈現（不就地回滾畫面）。
 */
export async function postKeywordOverride(
  term: string,
  kind: "positive" | "negative" | "engaged",
  action: "add" | "remove",
  signal?: AbortSignal,
): Promise<CriteriaProfile> {
  const res = await fetch(`${API_BASE}/me/keywords`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ term, kind, action }),
    signal,
  });
  if (!res.ok) throw new Error(`keyword override API ${res.status}`);
  return adaptProfile((await res.json()) as CriteriaProfileRaw);
}

// ── 行為回寫（Layer B 共享學習迴圈，fire-and-forget） ──────────────
// 後端 app/api/v1/behavior.py。Layer B 在白名單(@hqdesign.tw)合作範圍內共享，
// 供同事與 AI/agent 互相學習。白名單帳號登入後由 setCurrentUserId 注入 user_id，
// 行為依登入帳號「具名」回寫（見 CLAUDE.md）；未登入／示範模式則省略，後端落到
// 預設使用者。仍受後端兩段式同意把關（consent_shared=False 時不匯入共享庫）。
// localStorage 仍是前端真相來源，後端僅作學習匯入：失敗靜默、不阻塞 UI、不回滾。
async function postBehavior(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
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
