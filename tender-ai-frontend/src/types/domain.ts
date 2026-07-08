// 領域型別契約（對應 handoff §7：Tender / Source / Task / User / FilterState）
// 後端為獨立 FastAPI 服務，這些型別即前端與 API 的資料契約雛形。

export type Tier = "high" | "mid" | "low";

/** 資料來源：PCC 政府電子採購網、北醫 TMU、台北市 TPC、新北市 NPC */
export type SourceKey = "PCC" | "TMU" | "TPC" | "NPC";

/** 連線狀態：已連線 / 未綁定 / 連線失敗 / 離線（用快取） */
export type ConnectorState = "connected" | "unbound" | "failed" | "offline";

/** 看板欄位：待辦 / 進行中 / 審核中 / 已完成 */
export type TaskStatus = "todo" | "doing" | "review" | "done";

/** 採購類別（優先序 工程 > 財物 > 勞務） */
export type Category = "works" | "goods" | "services";

export interface Source {
  key: SourceKey;
  name: string;
  shortName: string;
  state: ConnectorState;
  /** 最後成功同步時間（ISO），離線時用 */
  lastSync?: string;
}

export interface Tender {
  id: string;
  title: string;
  /** 招標機關 */
  org: string;
  source: SourceKey;
  /** 預算金額（TWD） */
  budget: number;
  /** 截止投標（ISO date） */
  deadline: string;
  /** 公告日（ISO date） */
  publishedAt: string;
  tier: Tier;
  /** 分級分數：越小越高潛力（沿用 prototype，≤14 高 / 15–30 中 / ≥31 低） */
  score: number;
  /** 可行性 0–100 */
  feasibility: number;
  /** 供應商覆蓋 0–100 */
  supplierCoverage: number;
  category: Category;
  /** 命中的重點關鍵字 */
  tags: string[];
  /** 命中硬排除（如「綜合營造業」） */
  excluded?: boolean;
  excludeReason?: string;
  /** 下一步行動建議 */
  nextStep?: string;
  /** 負責人 userId */
  owner?: string;
  // ── 後端 TenderListItem 額外欄位（live 資料才有；mock 為 undefined）──
  /** 標案案號（後端 case_pk） */
  caseNo?: string;
  /** 招標方式（如「公開招標」） */
  tenderMethod?: string;
  /** PCC／來源原文連結 */
  link?: string;
  /** 截止日（民國格式原文） */
  deadlineRoc?: string;
  /** 標的縣市 */
  city?: string;
  /** 最後一次出現於每日快照（ISO date） */
  lastSeen?: string;
}

/** 單日快照（對應後端 SnapshotItem）：標案分級／剩餘天數隨日變化的軌跡點。 */
export interface TenderSnapshot {
  /** 快照日期（ISO date） */
  runDate: string;
  tier: Tier | null;
  /** 該快照當下的剩餘天數（快照值，非即時推算） */
  daysLeft: number | null;
}

/** 使用者對單案的後端狀態（對應 UserStateOut；P2 行為回寫後生效）。 */
export interface TenderUserState {
  saved: boolean;
  status: string | null;
  star: number | null;
}

/** 附件索引（對應後端 AttachmentItem）：實檔離庫，這裡只帶索引與下載結果註記。 */
export interface TenderAttachment {
  filename: string | null;
  url: string | null;
  /** 是否已歸檔到本地（後端 storage_uri 有值） */
  archived: boolean;
  /** enrich 時是否略過下載 */
  skipped?: boolean | null;
  /** 略過/失敗原因（如「檔案過大」） */
  error?: string | null;
}

/** 通用「屬性／標籤／內文／參數」結構條目（對應後端 StructuredItem）。
 *
 * 由長文欄位（目前為資格要求摘要 qualification_text）離線結構化而來，供表格呈現與後續向量化；
 * 設計成跨欄位可複用：`kind` 為條目型別（code 資格代碼／requirement 要求項／note 說明），
 * `label` 為標籤（代碼或項次，可空），`content` 為內文，`params` 為延伸參數。 */
export interface StructuredItem {
  /** 條目型別：code（資格代碼）／requirement（要求項）／note（說明）等 */
  kind: string;
  /** 標籤：資格代碼或項次（無則為 null） */
  label?: string | null;
  /** 內文 */
  content: string;
  /** 延伸參數（預設空物件，保留向量化／結構化擴充） */
  params: Record<string, unknown>;
}

/** 單案最新詳情版本（對應後端 RevisionDetail，皆 Layer A 公開欄位）。
 *
 * 僅在 enrich job 於「能連到 PCC 招標網」的環境跑過後才有值；未 enrich 時為 null，
 * 前端據此優雅退化為空狀態。 */
export interface TenderRevisionDetail {
  revisionNo: number;
  /** 詳情擷取時間（ISO datetime） */
  fetchedAt?: string | null;
  /** 決標方式（如「最有利標」） */
  awardMethod?: string | null;
  /** 是否須繳押標金 */
  depositRequired?: boolean | null;
  /** 押標金金額（TWD） */
  depositAmountTwd?: number | null;
  /** 押標金原文 */
  depositRawText?: string | null;
  /** 廠商資格代碼 */
  qualificationCodes: string[];
  /** 資格要求摘要（原始長文） */
  qualificationText?: string | null;
  /** 資格要求摘要的結構化條目（供表格呈現）；後端未落庫時由 qualificationText 即時結構化 */
  qualificationItems: StructuredItem[];
  /** 採購類別大類（工程/財物/勞務） */
  categoryMain?: string | null;
  /** 採購類別名稱 */
  categoryName?: string | null;
  /** 採購類別原文 */
  categoryRaw?: string | null;
  /** 履約期限 */
  performancePeriod?: string | null;
  /** 履約地點 */
  performanceLocation?: string | null;
  /** 補助來源 */
  subsidySource?: string | null;
  /** 其他備註 */
  extraNote?: string | null;
  /** 附件索引 */
  attachments: TenderAttachment[];
}

/** 標案完整詳情（對應後端 TenderDetail）：主檔 + 歷史快照 + 最新詳情版本 + 使用者狀態。 */
export interface TenderDetail extends Tender {
  snapshots: TenderSnapshot[];
  userState?: TenderUserState | null;
  /** 最新詳情版本（履約地點/資格/押標金/附件…）；未 enrich 時為 null。 */
  revision?: TenderRevisionDetail | null;
}

// ── SL3 意圖與推理（對應後端 app/schemas/reasoning.py，皆 Layer A 公開欄位）──

/** 推理方向：正向加分 / 負向扣分 / 中性提示（如急迫性）。 */
export type ReasonDirection = "positive" | "negative" | "neutral";

/** 結論分級：依 criteria_fit 推導。 */
export type ReasonVerdict = "strong" | "consider" | "weak";

/** 單一推理因素（類別／預算／地點／急迫／關鍵字／行為）。 */
export interface ReasonCode {
  /** category | budget | city | urgency | keyword | behavior | source */
  factor: string;
  /** 顯示用因素名（繁中），如「標的類別」 */
  label: string;
  /** 該標案在此因素上的取值，如「工程」 */
  value: string | null;
  direction: ReasonDirection;
  /** 帶符號影響量（約 -1..1，可解釋非機率），驅動排序 */
  impact: number;
  /** 一句話證據，如「你過去 8/8 件工程都判可行」 */
  evidence: string;
}

/** 某分類取值在歷史評估的關聯統計（lift = 可行機率 − 基準可行率）。 */
export interface CategorySignal {
  value: string;
  pFeasible: number;
  lift: number;
  support: number;
  feasible: number;
  infeasible: number;
}

/** 操作者判準輪廓：系統「學到」的承標標準（可被檢視）。 */
export interface CriteriaProfile {
  nEvaluations: number;
  nEvents: number;
  baseRate: number;
  categorySignals: CategorySignal[];
  citySignals: CategorySignal[];
  sourceSignals: CategorySignal[];
  budgetFeasibleMin: number | null;
  budgetFeasibleMax: number | null;
  budgetFeasibleMedian: number | null;
  topKeywordsPositive: string[];
  topKeywordsNegative: string[];
  engagedCategories: string[];
  engagedCities: string[];
  summary: string;
  confidence: "low" | "medium" | "high";
}

/** 單一標案的可中標推理（fit 分數 + 逐條 reason code + 結論 + 判準快照）。 */
export interface TenderReasoning {
  tenderId: number;
  criteriaFit: number;
  verdict: ReasonVerdict;
  headline: string;
  reasons: ReasonCode[];
  profile: CriteriaProfile;
}

export interface KanbanNote {
  id: string;
  author: string;
  createdAt: string;
  body: string;
}

export interface KanbanCard {
  id: string;
  tenderId?: string;
  title: string;
  status: TaskStatus;
  /** 負責人 userId */
  assignee?: string;
  tier?: Tier;
  deadline?: string;
  blocked?: boolean;
  blockReason?: string;
  notes?: KanbanNote[];
}

export interface User {
  id: string;
  name: string;
  initials: string;
  role: string;
  /** 頭像底色（CSS color） */
  color: string;
}

// ── 投標看板（Notion 式）：白名單成員 / 投標流程階段 / 子任務 / 投標專案 ──
// 新世界一律用 number id（對齊後端 users.id），與舊 KanbanCard 的 string id 兩層並存。

/** 白名單成員（對齊後端 users 表；前端事實來源為 tender:members，可被 fetchAccounts 補強）。 */
export interface Member {
  /** 對齊後端 users.id；mock 種子用小正整數 */
  id: number;
  name: string;
  /** @hqdesign.tw（合作範圍） */
  email: string | null;
  /** "admin" | "member" | … */
  role: string | null;
  /** 第 1 段同意：管理員開通白名單；唯有 true 才可被指派（Issue #1 名單來源） */
  whitelistActive: boolean;
  /** 第 2 段同意：本人同意行為具名共享（僅顯示，唯讀，不在前端切換） */
  consentShared: boolean;
  /** 由 authDisplay 衍生（頭像縮寫） */
  initials: string;
  /** 由 authDisplay 衍生（頭像底色） */
  color: string;
}

/** 投標流程階段，1:1 對齊後端 TenderUserState.status（觀望/備標中/已投/得標/放棄）。 */
export type BidStage =
  | "watching"
  | "preparing"
  | "submitted"
  | "won"
  | "abandoned";

/** 看板欄位順序（觀望→備標中→已投標→得標→放棄）。 */
export const BID_STAGE_ORDER: BidStage[] = [
  "watching",
  "preparing",
  "submitted",
  "won",
  "abandoned",
];

export type SubtaskStatus = "todo" | "doing" | "done";
export type SubtaskPriority = "low" | "mid" | "high";

export interface Subtask {
  id: string;
  title: string;
  description?: string;
  /** 指派給某 Member（白名單）；null＝未指派 */
  assigneeId?: number | null;
  status: SubtaskStatus;
  priority?: SubtaskPriority;
  /** 截止日（ISO date） */
  dueDate?: string | null;
  tags?: string[];
  /** 建立者（currentMemberId） */
  createdBy?: number | null;
  createdAt: string;
}

/** 投標專案（新看板的卡）；以 tenderId 對齊 Layer A 標案，可無（手動建立）。 */
export interface TenderProject {
  id: string;
  /** 有則卡片可點開 TenderDrawer（Issue #2） */
  tenderId?: string;
  title: string;
  stage: BidStage;
  tier?: Tier;
  /** 截止投標（ISO date） */
  deadline?: string;
  /** 專案負責人（白名單成員）；null＝未指派 */
  ownerId?: number | null;
  subtasks: Subtask[];
  /** 複用既有 KanbanNote（author 存成員 name 字串） */
  notes?: KanbanNote[];
  createdAt: string;
  updatedAt: string;
}

/** 投標看板檢視狀態（存 tender:board:view）。 */
export interface BoardView {
  /** 只看與我相關（owner 或任一子任務指派含當前帳號） */
  mineOnly: boolean;
  /** 依成員過濾（owner 或子任務指派含此成員）；null＝不限 */
  memberFilter: number | null;
  /** 依階段過濾；null＝全部 */
  stageFilter: BidStage | null;
}

export type ActivityKind =
  | "accept"
  | "skip"
  | "comment"
  | "move"
  | "import"
  | "rule"
  | "judge";

/**
 * 標案三分判斷（需求 D：✓/✗/⭐ 語意明確區分）。
 * - feasible：✓ 我可以做
 * - featured：⭐ 精選（強正向，feasible=可行＋featured）
 * - infeasible：✗ 不做（即時寫團隊負權，2026-06-24 覆寫紅線後）
 */
export type Verdict = "feasible" | "featured" | "infeasible";

export interface ActivityItem {
  id: string;
  /** ISO datetime */
  at: string;
  userId: string;
  kind: ActivityKind;
  /** 動作對象（標案名稱等） */
  target?: string;
}

export type SortKey = "score" | "deadline" | "budget" | "feasibility";
/** 排序方向：asc 升冪、desc 降冪 */
export type SortDir = "asc" | "desc";

export interface FilterState {
  query: string;
  sources: SourceKey[];
  tiers: Tier[];
  /** 預算下限（TWD），null = 不限 */
  minBudget: number | null;
  /** 預算上限（TWD），null = 不限 */
  maxBudget: number | null;
  /** 可行性下限（0-99），null = 不限 */
  minFeasibility: number | null;
  /** 可行性上限（0-99），null = 不限 */
  maxFeasibility: number | null;
  /** 只看命中重點關鍵字 */
  focusOnly: boolean;
  /** 隱藏硬排除項 */
  hideExcluded: boolean;
  sort: SortKey;
  /** 排序方向（搭配 sort）；切換排序欄時重設為該欄預設方向 */
  sortDir: SortDir;
  /** 採購類別篩選（空=不限） */
  categories: Category[];
  /** 機關名稱關鍵字（包含比對） */
  orgKeyword: string;
  /** 截止日下界（ISO date），null = 不限 */
  deadlineFrom: string | null;
  /** 截止日上界（ISO date），null = 不限 */
  deadlineTo: string | null;
  /** 標籤篩選（命中任一即通過，空=不限） */
  tagFilter: string[];
  /** 只看北部城市（台北/新北/基隆/桃園） */
  northOnly: boolean;
  /** 只看當日新案（lastSeen/publishedAt 為今天） */
  newToday: boolean;
}

export interface Comment {
  id: string;
  tenderId: string;
  userId: string;
  at: string;
  text: string;
}

/** 已儲存的篩選預設（saved-searches）；filter 存整份 FilterState 以便完整套用。 */
export interface SavedSearch {
  id: number;
  name: string;
  filter: FilterState;
}
