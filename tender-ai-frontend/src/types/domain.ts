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

/** 標案完整詳情（對應後端 TenderDetail）：主檔 + 歷史快照 + 使用者狀態。 */
export interface TenderDetail extends Tender {
  snapshots: TenderSnapshot[];
  userState?: TenderUserState | null;
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

export type ActivityKind =
  | "accept"
  | "skip"
  | "comment"
  | "move"
  | "import"
  | "rule";

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

export interface FilterState {
  query: string;
  sources: SourceKey[];
  tiers: Tier[];
  /** 預算上限（TWD），null = 不限 */
  maxBudget: number | null;
  /** 只看命中重點關鍵字 */
  focusOnly: boolean;
  /** 隱藏硬排除項 */
  hideExcluded: boolean;
  sort: SortKey;
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
