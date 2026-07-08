import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActivityItem,
  ActivityKind,
  BidStage,
  BoardView,
  Comment,
  FilterState,
  KanbanCard,
  KanbanNote,
  Member,
  SavedSearch,
  SortDir,
  SortKey,
  Subtask,
  SubtaskPriority,
  TaskStatus,
  Tender,
  TenderProject,
  Tier,
  Verdict,
} from "@/types/domain";
import { TENDERS } from "@/data/tenders";
import { KANBAN_CARDS } from "@/data/kanban";
import { ACTIVITY } from "@/data/activity";
import { USERS, userById } from "@/data/users";
import { SEED_MEMBERS } from "@/data/members";
import { useAuth } from "@/store/auth-context";
import {
  authDisplay,
  deleteAccount,
  fetchAccounts,
  setWhitelist,
} from "@/lib/auth-api";
import {
  fetchTenders,
  postAccept,
  postEvaluate,
  postNote,
  postSave,
  fetchSavedSearches,
  postSavedSearch,
  fetchUserDecisions,
  type EvaluateResult,
  type FeasibleVerdict,
} from "@/lib/api";
import { trackEvent } from "@/lib/events";
import { load, save } from "@/lib/storage";
import { daysLeft } from "@/lib/format";
import {
  cardsToProjects,
  filterAssignableMembers,
  filterVisibleProjects,
  mergeAccountsIntoMembers,
} from "@/store/board-logic";
import { keywordHits } from "@/lib/keyword-hits";
import {
  computeFeasibility,
  type FeasResult,
  type FeasLabels,
} from "@/lib/feasibility";
import { NORTH_CITIES, serializeFilter, parseFilter } from "@/lib/url-filter";

// ── 規則初始值 ────────────────────────────────────────────────
const DEFAULT_FOCUS = ["廁所", "衛浴", "室內裝修", "醫院", "機房"];
const DEFAULT_AVOID = ["外牆", "泥作"];
const DEFAULT_HARD = ["綜合營造業", "清潔", "保全"];

// 近 7 日新案趨勢（末值對齊今日匯入 14 筆）
const TREND_7D = [3, 5, 2, 6, 4, 8, 14];

const DEFAULT_FILTER: FilterState = {
  query: "",
  sources: [],
  tiers: [],
  minBudget: null,
  maxBudget: null,
  minFeasibility: null,
  maxFeasibility: null,
  focusOnly: false,
  hideExcluded: true,
  sort: "score",
  sortDir: "asc",
  categories: [],
  orgKeyword: "",
  deadlineFrom: null,
  deadlineTo: null,
  tagFilter: [],
  northOnly: false,
  newToday: false,
};

export type RuleList = "focus" | "avoid" | "hard";

const STATUS_LABEL_ZH: Record<TaskStatus, string> = {
  todo: "待辦",
  doing: "進行中",
  review: "審核中",
  done: "已完成",
};

const RULE_LABEL_ZH: Record<RuleList, string> = {
  focus: "重點關鍵字",
  avoid: "避免關鍵字",
  hard: "硬排除",
};

// ── 工具 ──────────────────────────────────────────────────────
let _seq = 0;
function uid(): string {
  _seq += 1;
  return `${Date.now().toString(36)}-${_seq}`;
}
function nowISO(): string {
  return new Date().toISOString();
}

// ── 投標看板（Notion 式）：階段標籤 / 狀態→階段遷移 / 成員 email 規則 / 種子 ──
const STAGE_LABEL_ZH: Record<BidStage, string> = {
  watching: "觀望",
  preparing: "備標中",
  submitted: "已投標",
  won: "得標",
  abandoned: "放棄",
};

// 合作範圍 email：限 @hqdesign.tw（治理紅線；新增成員時驗證）。
const HQ_EMAIL_RE = /^[^@\s]+@hqdesign\.tw$/;

// 每個排序欄「首次點擊」的預設方向（沿用既有預設行為）：
// 預算/可行性 大→小（desc）最直覺；截止/分數 小→大（asc）。
export const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  score: "asc",
  deadline: "asc",
  budget: "desc",
  feasibility: "desc",
};

// 自然升冪比較（asc）；降冪由外層取負號，集中管理避免兩份相反邏輯漂移。
function baseComparator(sort: SortKey): (a: Tender, b: Tender) => number {
  switch (sort) {
    case "deadline":
      return (a, b) => a.deadline.localeCompare(b.deadline);
    case "budget":
      return (a, b) => a.budget - b.budget;
    case "feasibility":
      return (a, b) => a.feasibility - b.feasibility;
    case "score":
    default:
      return (a, b) => a.score - b.score;
  }
}

function comparator(
  sort: SortKey,
  dir: SortDir,
): (a: Tender, b: Tender) => number {
  const base = baseComparator(sort);
  return dir === "asc" ? base : (a, b) => -base(a, b);
}

export interface Metrics {
  kpiNew: number;
  kpiHigh: number;
  kpiClosing: number;
  kpiInProgress: number;
  kpiAccepted: number;
}

// 處置（決策回顧）：單一彙總標案目前落在哪個桶。
// 優先序：skipped（淘汰，明確負向終態）> accepted（有進行中投標專案）> starred（收藏）> none。
// 註：略過採「軟移動」——承接後再淘汰會保留專案卡並轉「放棄」階段，故淘汰優先於承接判定。
export type Disposition = "accepted" | "starred" | "skipped" | "none";

// 具名淘汰理由（Layer B 合作範圍內共享、依登入帳號具名；對外不揭露、匯出去識別化）。
export interface DiscardReason {
  reason: string;
  /** 具名貢獻者＝登入帳號名稱（@hqdesign.tw 白名單內） */
  by: string;
  /** ISO 時間 */
  at: string;
}

interface AppDataValue {
  // 篩選
  filter: FilterState;
  setFilter: (patch: Partial<FilterState>) => void;
  resetFilter: () => void;
  /** 點擊可排序表頭：同欄翻轉方向、換欄套用預設方向 */
  toggleSort: (key: SortKey) => void;
  // 標案
  tenders: Tender[];
  filteredTenders: Tender[];
  isExcluded: (t: Tender) => boolean;
  excludeReasonOf: (t: Tender) => string | undefined;
  hasFocus: (t: Tender) => boolean;
  // 資料來源狀態：true=後端真實資料、false=mock fallback
  usingLiveData: boolean;
  // 初次抓取中：用於列表 skeleton（純 mock 模式恆為 false）
  tendersLoading: boolean;
  // 星號
  isStarred: (tenderId: string) => boolean;
  toggleStar: (tenderId: string) => void;
  // 行動
  accept: (tenderId: string) => void;
  skip: (tenderId: string) => void;
  // 處置回顧（決策回顧頁）：彙總目前處置、重新分流、具名淘汰理由。
  isSkipped: (tenderId: string) => boolean;
  isAccepted: (tenderId: string) => boolean;
  dispositionOf: (tenderId: string) => Disposition;
  /** 重新分流：在 收藏／承接／淘汰／無 之間移動；淘汰採軟移動、可附具名理由。 */
  reclassify: (
    tenderId: string,
    to: Disposition,
    opts?: { reason?: string },
  ) => void;
  discardReasonOf: (tenderId: string) => DiscardReason | undefined;
  setDiscardReason: (tenderId: string, reason: string) => void;
  // 三分判斷（✓ 可行 / ✗ 不可行 / ⭐ 精選）：附大致原因，即時併入 Layer B→C 學習。
  verdictOf: (tenderId: string) => Verdict | undefined;
  judge: (
    tenderId: string,
    verdict: Verdict,
    rationale: string,
    chips: string[],
  ) => Promise<EvaluateResult | null>;
  // 註記
  commentsOf: (tenderId: string) => Comment[];
  addComment: (tenderId: string, text: string) => void;
  // 看板
  cards: KanbanCard[];
  moveCard: (cardId: string, status: TaskStatus) => void;
  addCardNote: (cardId: string, body: string) => void;
  removeCardNote: (cardId: string, noteId: string) => void;
  forwardCard: (cardId: string, toUserId: string) => void;
  // 動態
  activity: ActivityItem[];
  // 規則
  focusKeywords: string[];
  avoidKeywords: string[];
  hardExclude: string[];
  addKeyword: (list: RuleList, word: string) => void;
  removeKeyword: (list: RuleList, word: string) => void;
  addKeywords: (list: RuleList, words: string[]) => void;
  moveKeyword: (from: RuleList, to: RuleList, word: string) => void;
  replaceKeywords: (list: RuleList, words: string[]) => void;
  clearKeywords: (list: RuleList) => void;
  // 衍生：可行性 / 關鍵字命中
  feasOf: (t: Tender) => FeasResult;
  keywordHitsOf: (t: Tender) => string[];
  // 指標
  metrics: Metrics;
  trend7d: number[];
  // 篩選預設（saved-searches）
  savedSearches: SavedSearch[];
  saveCurrentSearch: (name: string) => void;
  applySavedSearch: (id: number) => void;
  // ── 投標看板（Notion 式）──────────────────────────────────────
  /** 當前登入帳號對應的成員 id（mock=0；anonymous=null） */
  currentMemberId: number | null;
  projects: TenderProject[];
  /** 套用 boardView 過濾後、依階段分組（看板欄位用） */
  projectsByStage: Record<BidStage, TenderProject[]>;
  /** 套用 boardView 過濾後的專案（未分組） */
  visibleProjects: TenderProject[];
  moveProjectStage: (id: string, stage: BidStage) => void;
  addProject: (input: {
    title: string;
    tenderId?: string;
    tier?: Tier;
    deadline?: string;
    stage?: BidStage;
  }) => void;
  updateProject: (
    id: string,
    patch: Partial<
      Pick<TenderProject, "title" | "tier" | "deadline" | "stage" | "ownerId">
    >,
  ) => void;
  removeProject: (id: string) => void;
  addProjectNote: (projectId: string, body: string) => void;
  removeProjectNote: (projectId: string, noteId: string) => void;
  addSubtask: (
    projectId: string,
    input: {
      title: string;
      description?: string;
      assigneeId?: number | null;
      priority?: SubtaskPriority;
      dueDate?: string | null;
      tags?: string[];
    },
  ) => void;
  updateSubtask: (
    projectId: string,
    subtaskId: string,
    patch: Partial<
      Pick<
        Subtask,
        | "title"
        | "description"
        | "status"
        | "priority"
        | "dueDate"
        | "tags"
        | "assigneeId"
      >
    >,
  ) => void;
  assignSubtask: (
    projectId: string,
    subtaskId: string,
    memberId: number | null,
  ) => void;
  toggleSubtask: (projectId: string, subtaskId: string) => void;
  removeSubtask: (projectId: string, subtaskId: string) => void;
  subtaskProgressOf: (project: TenderProject) => {
    done: number;
    total: number;
  };
  // ── 成員（白名單）────────────────────────────────────────────
  members: Member[];
  /** Issue #1 指派名單唯一來源：僅 whitelistActive 成員 */
  assignableMembers: Member[];
  memberById: (id: number | null | undefined) => Member | undefined;
  addMember: (input: { name: string; email: string; role?: string }) => void;
  updateMember: (
    id: number,
    patch: Partial<Pick<Member, "name" | "role" | "email">>,
  ) => void;
  toggleMemberWhitelist: (id: number) => void;
  removeMember: (id: number) => void;
  // ── 檢視 ──────────────────────────────────────────────────────
  boardView: BoardView;
  setBoardView: (patch: Partial<BoardView>) => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  // 本地 mock 行為流／看板筆記的作者身分（沿用切換器移除前的預設身分）。
  // 具名的 Layer B 行為事件改由 events.ts 帶入登入帳號（setCurrentUserId）。
  const person = USERS[0];

  // 登入身分（AuthProvider 已包住本 Provider）：供具名擁有／指派與白名單 hydration。
  const { user, isAdmin } = useAuth();
  const currentMemberId = user?.id ?? null;
  const currentMemberName = user?.name ?? person.name;

  // 後端對接：初始為 mock，掛載後抓真實標案；失敗則維持 mock，不中斷 UI。
  const [tenders, setTenders] = useState<Tender[]>(TENDERS);
  const [usingLiveData, setUsingLiveData] = useState(false);
  // 初次抓取狀態：API 模式為 true（顯示 skeleton），純 mock 模式直接 false。
  const [tendersLoading, setTendersLoading] = useState(
    import.meta.env.VITE_USE_API !== "false",
  );
  useEffect(() => {
    if (import.meta.env.VITE_USE_API === "false") return;
    const ac = new AbortController();
    fetchTenders(ac.signal)
      .then((list) => {
        if (list.length) {
          setTenders(list);
          setUsingLiveData(true);
        }
        // 列表載入完成送一次 view（不帶 tender_id）。
        trackEvent("view", { payload: { count: list.length } });
      })
      .catch(() => {
        /* 後端未啟動／錯誤：保留 mock 資料 */
      })
      .finally(() => setTendersLoading(false));
    return () => ac.abort();
  }, []);

  const [filter, setFilterState] = useState<FilterState>(() => {
    const stored = { ...DEFAULT_FILTER, ...load("filter", DEFAULT_FILTER) };
    if (typeof window !== "undefined" && window.location.search) {
      return parseFilter(window.location.search, stored);
    }
    return stored;
  });
  const [comments, setComments] = useState<Comment[]>(() =>
    load<Comment[]>("comments", []),
  );
  const [cards, setCards] = useState<KanbanCard[]>(() =>
    load<KanbanCard[]>("cards", KANBAN_CARDS),
  );
  const [activity, setActivity] = useState<ActivityItem[]>(() =>
    load<ActivityItem[]>("activity", ACTIVITY),
  );
  const [starred, setStarred] = useState<Set<string>>(
    () => new Set(load<string[]>("starred", [])),
  );
  const [skipped, setSkipped] = useState<Set<string>>(
    () => new Set(load<string[]>("skipped", [])),
  );
  // 三分判斷（需求 D）：tenderId → verdict，localStorage 為前端真相來源；
  // 後端 /evaluate 僅作即時 Layer B→C 學習匯入（失敗不回滾本地）。
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() =>
    load<Record<string, Verdict>>("verdicts", {}),
  );
  // 具名淘汰理由（決策回顧）：tenderId → {reason, by, at}，localStorage 為前端真相來源。
  // key 經 storage 前綴後落為 "tender:discard-reason"。
  const [discardReasons, setDiscardReasons] = useState<
    Record<string, DiscardReason>
  >(() => load<Record<string, DiscardReason>>("discard-reason", {}));
  const [focusKeywords, setFocus] = useState<string[]>(() =>
    load("rules:focus", DEFAULT_FOCUS),
  );
  const [avoidKeywords, setAvoid] = useState<string[]>(() =>
    load("rules:avoid", DEFAULT_AVOID),
  );
  const [hardExclude, setHard] = useState<string[]>(() =>
    load("rules:hard", DEFAULT_HARD),
  );

  // 投標看板（Notion 式）：專案 / 成員 / 檢視狀態（前端優先，localStorage 為事實來源）。
  const [projects, setProjects] = useState<TenderProject[]>(() => {
    const stored = load<TenderProject[] | null>("projects", null);
    return stored ?? cardsToProjects(KANBAN_CARDS, nowISO());
  });
  const [members, setMembers] = useState<Member[]>(() =>
    load<Member[]>("members", SEED_MEMBERS),
  );
  const [boardView, setBoardViewState] = useState<BoardView>(() =>
    load<BoardView>("board:view", {
      mineOnly: false,
      memberFilter: null,
      stageFilter: null,
    }),
  );

  // 持久化
  useEffect(() => save("filter", filter), [filter]);

  // URL 同步：filter 變更時更新 query，不新增歷史記錄
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = serializeFilter(filter);
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [filter]);
  useEffect(() => save("comments", comments), [comments]);
  useEffect(() => save("cards", cards), [cards]);
  useEffect(() => save("activity", activity), [activity]);
  useEffect(() => save("starred", [...starred]), [starred]);
  useEffect(() => save("skipped", [...skipped]), [skipped]);
  useEffect(() => save("verdicts", verdicts), [verdicts]);
  useEffect(() => save("discard-reason", discardReasons), [discardReasons]);
  useEffect(() => save("rules:focus", focusKeywords), [focusKeywords]);
  useEffect(() => save("rules:avoid", avoidKeywords), [avoidKeywords]);
  useEffect(() => save("rules:hard", hardExclude), [hardExclude]);
  useEffect(() => save("projects", projects), [projects]);
  useEffect(() => save("members", members), [members]);
  useEffect(() => save("board:view", boardView), [boardView]);

  const pushActivity = useCallback(
    (kind: ActivityKind, target: string) => {
      setActivity((prev) =>
        [
          { id: `a-${uid()}`, at: nowISO(), userId: person.id, kind, target },
          ...prev,
        ].slice(0, 60),
      );
    },
    [person.id],
  );

  // ── 排除判定 ────────────────────────────────────────────────
  const isExcluded = useCallback(
    (t: Tender): boolean => {
      if (skipped.has(t.id)) return true;
      if (t.excluded) return true;
      const hay = `${t.title} ${t.org} ${t.excludeReason ?? ""} ${t.tags.join(" ")}`;
      return hardExclude.some((k) => k && hay.includes(k));
    },
    [skipped, hardExclude],
  );

  const excludeReasonOf = useCallback(
    (t: Tender): string | undefined => {
      if (skipped.has(t.id)) return "手動略過";
      if (t.excludeReason) return t.excludeReason;
      const hay = `${t.title} ${t.org} ${t.tags.join(" ")}`;
      const k = hardExclude.find((kw) => kw && hay.includes(kw));
      return k ? `硬排除：${k}` : undefined;
    },
    [skipped, hardExclude],
  );

  const hasFocus = useCallback(
    (t: Tender): boolean => {
      if (t.tags.some((tag) => focusKeywords.includes(tag))) return true;
      return focusKeywords.some((k) => k && t.title.includes(k));
    },
    [focusKeywords],
  );

  // ── 衍生：可行性 breakdown 標籤（穩定 key，i18n 由顯示端決定）
  const feasLabels: FeasLabels = useMemo(
    () => ({
      works: "工程",
      goods: "財物",
      services: "勞務",
      budgetFit: "預算適配",
      deadlineFar: "截止充裕",
      deadlineMid: "截止適中",
      deadlineNear: "截止近",
      hardExcluded: "硬排除",
    }),
    [],
  );

  const feasMap = useMemo(() => {
    const m = new Map<string, FeasResult>();
    for (const t of tenders) {
      m.set(
        t.id,
        computeFeasibility(
          t,
          { focus: focusKeywords, hard: hardExclude },
          t.deadline ? daysLeft(t.deadline) : 0,
          feasLabels,
        ),
      );
    }
    return m;
  }, [tenders, focusKeywords, hardExclude, feasLabels]);

  const feasOf = useCallback(
    (t: Tender): FeasResult =>
      feasMap.get(t.id) ?? { score: t.feasibility, breakdown: [] },
    [feasMap],
  );

  const keywordHitsOf = useCallback(
    (t: Tender): string[] => keywordHits(t, focusKeywords),
    [focusKeywords],
  );

  const todayISO = new Date().toISOString().slice(0, 10);

  // ── 衍生：篩選後標案 ────────────────────────────────────────
  const filteredTenders = useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    const list = tenders.filter((t) => {
      if (q) {
        const hay = `${t.title} ${t.org} ${t.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter.sources.length && !filter.sources.includes(t.source))
        return false;
      if (filter.tiers.length && !filter.tiers.includes(t.tier)) return false;
      if (filter.minBudget != null && t.budget < filter.minBudget) return false;
      if (filter.maxBudget != null && t.budget > filter.maxBudget) return false;
      // 可行性用原始欄位 t.feasibility 過濾（與畫面上的 FeasibilityMeter 一致）。
      if (
        filter.minFeasibility != null &&
        t.feasibility < filter.minFeasibility
      )
        return false;
      if (
        filter.maxFeasibility != null &&
        t.feasibility > filter.maxFeasibility
      )
        return false;
      if (filter.focusOnly && !hasFocus(t)) return false;
      if (filter.hideExcluded && isExcluded(t)) return false;
      if (filter.categories.length && !filter.categories.includes(t.category))
        return false;
      if (filter.orgKeyword.trim() && !t.org.includes(filter.orgKeyword.trim()))
        return false;
      if (filter.deadlineFrom && t.deadline < filter.deadlineFrom) return false;
      if (filter.deadlineTo && t.deadline > filter.deadlineTo) return false;
      if (
        filter.tagFilter.length &&
        !filter.tagFilter.some((tag) => t.tags.includes(tag))
      )
        return false;
      if (filter.northOnly) {
        const city = t.city ?? "";
        if (!NORTH_CITIES.some((c) => city.includes(c))) return false;
      }
      if (filter.newToday) {
        const seen = (t.lastSeen ?? t.publishedAt ?? "").slice(0, 10);
        if (seen !== todayISO) return false;
      }
      return true;
    });
    if (filter.sort === "feasibility") {
      // 可行性以衍生分數 feasOf 排序（非原始欄位）；asc 低→高、desc 高→低。
      const base = (a: Tender, b: Tender) => feasOf(a).score - feasOf(b).score;
      return list.sort(filter.sortDir === "asc" ? base : (a, b) => -base(a, b));
    }
    return list.sort(comparator(filter.sort, filter.sortDir));
  }, [tenders, filter, hasFocus, isExcluded, feasOf, todayISO]);

  // ── 指標 ────────────────────────────────────────────────────
  const metrics = useMemo<Metrics>(() => {
    const visible = tenders.filter((t) => !isExcluded(t));
    // 今日新案：以資料集中最新出現日為「今日」，計入該日首次出現（publishedAt）的案。
    // 真實資料時即當日新案；資料較舊時則為最新一批新案（誠實反映，不灌假數）。
    const latest = visible.reduce((mx, t) => {
      const seen = (t.lastSeen ?? t.publishedAt ?? "").slice(0, 10);
      return seen > mx ? seen : mx;
    }, "");
    const kpiNew = latest
      ? visible.filter((t) => (t.publishedAt ?? "").slice(0, 10) === latest)
          .length
      : 0;
    return {
      kpiNew,
      kpiHigh: visible.filter((t) => t.tier === "high").length,
      kpiClosing: visible.filter((t) => {
        const d = daysLeft(t.deadline);
        return d >= 0 && d <= 7;
      }).length,
      kpiInProgress: cards.filter(
        (c) => c.status === "doing" || c.status === "review",
      ).length,
      kpiAccepted: cards.filter((c) => c.status === "done").length,
    };
  }, [tenders, cards, isExcluded]);

  // ── 埋點：篩選／搜尋／排序 ──────────────────────────────────
  // search 與 apply_filter 隨輸入連發 → debounce ~400ms；sort 變更即時送。
  const trackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedTrack = useCallback(
    (type: "search" | "apply_filter", payload: Record<string, unknown>) => {
      if (trackTimer.current) clearTimeout(trackTimer.current);
      trackTimer.current = setTimeout(() => trackEvent(type, { payload }), 400);
    },
    [],
  );
  useEffect(
    () => () => {
      if (trackTimer.current) clearTimeout(trackTimer.current);
    },
    [],
  );

  // ── 行動 ────────────────────────────────────────────────────
  const setFilter = useCallback(
    (patch: Partial<FilterState>) => {
      setFilterState((prev) => {
        const next = { ...prev, ...patch };
        // 依變更內容分類埋點：
        if ("query" in patch && patch.query !== prev.query) {
          debouncedTrack("search", { q: next.query });
        } else if ("sort" in patch && patch.sort !== prev.sort) {
          trackEvent("sort", { payload: { sort: next.sort } });
        } else {
          // 其餘篩選條件（來源／分級／預算／focusOnly／hideExcluded）變更。
          debouncedTrack("apply_filter", {
            sources: next.sources,
            tiers: next.tiers,
            minBudget: next.minBudget,
            maxBudget: next.maxBudget,
            minFeasibility: next.minFeasibility,
            maxFeasibility: next.maxFeasibility,
            focusOnly: next.focusOnly,
            hideExcluded: next.hideExcluded,
            categories: next.categories,
            orgKeyword: next.orgKeyword,
            deadlineFrom: next.deadlineFrom,
            deadlineTo: next.deadlineTo,
            tagFilter: next.tagFilter,
          });
        }
        return next;
      });
    },
    [debouncedTrack],
  );
  const resetFilter = useCallback(() => setFilterState(DEFAULT_FILTER), []);

  // 點擊可排序表頭：同欄翻轉方向；換欄則套用該欄預設方向。
  const toggleSort = useCallback(
    (key: SortKey) => {
      setFilter(
        filter.sort === key
          ? { sortDir: filter.sortDir === "asc" ? "desc" : "asc" }
          : { sort: key, sortDir: SORT_DEFAULT_DIR[key] },
      );
    },
    [filter.sort, filter.sortDir, setFilter],
  );

  // 篩選預設：localStorage 為真相來源；live 時掛載合併雲端（同名以雲端為準）。
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() =>
    load<SavedSearch[]>("savedSearches", []),
  );

  useEffect(() => {
    if (import.meta.env.VITE_USE_API === "false") return;
    const ac = new AbortController();
    fetchSavedSearches(ac.signal)
      .then((remote) => {
        if (!remote.length) return;
        setSavedSearches((local) => {
          const byName = new Map<string, SavedSearch>();
          for (const s of local) byName.set(s.name, s);
          for (const s of remote) byName.set(s.name, s); // 雲端覆蓋同名
          const merged = [...byName.values()];
          save("savedSearches", merged);
          return merged;
        });
      })
      .catch(() => {
        /* 雲端讀取失敗：維持 localStorage，不影響 UI */
      });
    return () => ac.abort();
  }, []);

  // 決策回顧水合（P4 真資料端點）：由後端 Layer B 行為訊號重建本人的星星／打勾／叉叉處置，
  // 補進 starred / skipped 與具名淘汰理由。原則：localStorage 為真相，**只填空缺**（local-wins）——
  // 已在本地分類（starred/skipped/有進行中專案）的標案不被遠端改判；理由僅在本地缺漏時補上。
  // accepted 由看板 projects 管理，不在此水合建立專案卡（維持既有範圍）。
  // 後端唯讀、不寫任何權重／狀態；後端不可達時靜默維持本地（不影響純 mock 模式）。
  useEffect(() => {
    if (import.meta.env.VITE_USE_API === "false") return;
    const ac = new AbortController();
    fetchUserDecisions({ signal: ac.signal })
      .then((data) => {
        if (!data.decisions.length) return;
        // mount 當下的本地真相（直接讀 localStorage，避免把 state 列為 effect 依賴）
        const localStarred = load<string[]>("starred", []);
        const localSkipped = load<string[]>("skipped", []);
        const localProjects = load<TenderProject[]>("projects", []);
        const classified = new Set<string>([
          ...localStarred,
          ...localSkipped,
          ...localProjects
            .filter((p) => p.tenderId && p.stage !== "abandoned")
            .map((p) => p.tenderId as string),
        ]);

        const addSkip: string[] = [];
        const addStar: string[] = [];
        const reasonFills: Record<string, DiscardReason> = {};
        for (const d of data.decisions) {
          // 淘汰理由：只要遠端有具名理由就列為候選（稍後僅填本地缺漏），與分類判定獨立。
          if (d.disposition === "skipped" && d.reason?.trim() && d.by) {
            reasonFills[d.tenderId] = {
              reason: d.reason,
              by: d.by,
              at: d.at ?? "",
            };
          }
          if (classified.has(d.tenderId)) continue; // 已本地分類：local-wins
          if (d.disposition === "skipped") addSkip.push(d.tenderId);
          else if (d.disposition === "starred") addStar.push(d.tenderId);
        }

        if (addSkip.length) {
          setSkipped((prev) => {
            const next = new Set(prev);
            for (const id of addSkip) next.add(id);
            save("skipped", [...next]);
            return next;
          });
        }
        if (addStar.length) {
          setStarred((prev) => {
            const next = new Set(prev);
            for (const id of addStar) next.add(id);
            save("starred", [...next]);
            return next;
          });
        }
        if (Object.keys(reasonFills).length) {
          setDiscardReasons((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const [id, r] of Object.entries(reasonFills)) {
              if (!next[id]) {
                next[id] = r;
                changed = true;
              }
            }
            if (!changed) return prev;
            save("discard-reason", next);
            return next;
          });
        }
      })
      .catch(() => {
        /* 後端不可達：維持 localStorage，不影響 UI */
      });
    return () => ac.abort();
  }, []);

  const saveCurrentSearch = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const entry: SavedSearch = { id: Date.now(), name: trimmed, filter };
      setSavedSearches((prev) => {
        const next = [...prev.filter((s) => s.name !== trimmed), entry];
        save("savedSearches", next);
        return next;
      });
      // 鏡射到後端（best-effort）；成功則以真實 id 取代暫時 id。
      void postSavedSearch(trimmed, filter)
        .then((row) => {
          if (!row) return;
          setSavedSearches((prev) => {
            const next = prev.map((s) =>
              s.name === trimmed ? { ...s, id: row.id } : s,
            );
            save("savedSearches", next);
            return next;
          });
        })
        .catch(() => {
          /* 後端鏡射失敗：localStorage 已存，UI 不受影響 */
        });
    },
    [filter],
  );

  const applySavedSearch = useCallback(
    (id: number) => {
      const found = savedSearches.find((s) => s.id === id);
      // 舊 saved search 可能缺新增欄位；先併預設值再套用，避免殘留上一組篩選。
      if (found) setFilter({ ...DEFAULT_FILTER, ...found.filter });
    },
    [savedSearches, setFilter],
  );

  const isStarred = useCallback(
    (tenderId: string) => starred.has(tenderId),
    [starred],
  );
  const toggleStar = useCallback(
    (tenderId: string) => {
      const willStar = !starred.has(tenderId);
      setStarred((prev) => {
        const next = new Set(prev);
        if (willStar) next.add(tenderId);
        else next.delete(tenderId);
        return next;
      });
      // 行為回寫（Layer B）：收藏狀態寫回學習迴圈，fire-and-forget。
      postSave(tenderId, willStar);
    },
    [starred],
  );

  const accept = useCallback(
    (tenderId: string) => {
      const t = tenders.find((x) => x.id === tenderId);
      if (!t) return;
      setSkipped((prev) => {
        if (!prev.has(tenderId)) return prev;
        const next = new Set(prev);
        next.delete(tenderId);
        return next;
      });
      setCards((prev) => {
        if (prev.some((c) => c.tenderId === tenderId)) return prev;
        const card: KanbanCard = {
          id: `k-${uid()}`,
          tenderId,
          title: t.title,
          status: "todo",
          assignee: person.id,
          tier: t.tier,
          deadline: t.deadline,
        };
        return [card, ...prev];
      });
      // 新投標看板：承接同時建立 TenderProject（觀望階段、負責人＝當前帳號），依 tenderId 去重。
      setProjects((prev) => {
        if (prev.some((p) => p.tenderId === tenderId)) return prev;
        const ts = nowISO();
        const proj: TenderProject = {
          id: `p-${uid()}`,
          tenderId,
          title: t.title,
          stage: "watching",
          tier: t.tier,
          deadline: t.deadline,
          ownerId: currentMemberId,
          subtasks: [],
          notes: [],
          createdAt: ts,
          updatedAt: ts,
        };
        return [proj, ...prev];
      });
      pushActivity("accept", t.title);
      // 行為回寫（Layer B）：承接 → 後端標記備標中。
      postAccept(tenderId, "備標中");
    },
    [tenders, person.id, currentMemberId, pushActivity],
  );

  const skip = useCallback(
    (tenderId: string) => {
      const t = tenders.find((x) => x.id === tenderId);
      setSkipped((prev) => new Set(prev).add(tenderId));
      if (t) pushActivity("skip", t.title);
      // 行為回寫（Layer B）：略過 → 後端標記放棄。
      postAccept(tenderId, "放棄");
    },
    [tenders, pushActivity],
  );

  // ── 處置回顧（決策回顧頁）──────────────────────────────────────
  const isSkipped = useCallback(
    (tenderId: string) => skipped.has(tenderId),
    [skipped],
  );
  // 承接＝有進行中（非「放棄」階段）的投標專案；淘汰後軟移動轉「放棄」即排除在外。
  const isAccepted = useCallback(
    (tenderId: string) =>
      projects.some((p) => p.tenderId === tenderId && p.stage !== "abandoned"),
    [projects],
  );
  // 單一彙總目前處置（優先序見 Disposition 型別說明）。
  const dispositionOf = useCallback(
    (tenderId: string): Disposition => {
      if (skipped.has(tenderId)) return "skipped";
      if (
        projects.some((p) => p.tenderId === tenderId && p.stage !== "abandoned")
      )
        return "accepted";
      if (starred.has(tenderId)) return "starred";
      return "none";
    },
    [skipped, projects, starred],
  );
  const discardReasonOf = useCallback(
    (tenderId: string): DiscardReason | undefined => discardReasons[tenderId],
    [discardReasons],
  );
  // 具名淘汰理由：寫入帶當前登入帳號名稱與時間；空字串＝清除該筆。
  const setDiscardReason = useCallback(
    (tenderId: string, reason: string) => {
      const trimmed = reason.trim();
      setDiscardReasons((prev) => {
        if (!trimmed) {
          if (!(tenderId in prev)) return prev;
          const next = { ...prev };
          delete next[tenderId];
          return next;
        }
        return {
          ...prev,
          [tenderId]: { reason: trimmed, by: currentMemberName, at: nowISO() },
        };
      });
    },
    [currentMemberName],
  );

  // 重新分流：在 收藏／承接／淘汰／無 之間移動。沿用 accept/skip/toggleStar 的既有副作用語意，
  // 不硬刪資料（淘汰為軟移動：保留專案卡並轉「放棄」階段）。
  // 紅線：本函式不寫任何關鍵字負權重；迴避字根仍須走 SwipeDecisionDialog→postKeywordOverride 人工確認。
  const reclassify = useCallback(
    (tenderId: string, to: Disposition, opts?: { reason?: string }) => {
      const t = tenders.find((x) => x.id === tenderId);
      const removeFromSkipped = () =>
        setSkipped((prev) => {
          if (!prev.has(tenderId)) return prev;
          const next = new Set(prev);
          next.delete(tenderId);
          return next;
        });

      if (to === "skipped") {
        // 淘汰：加入略過、進行中專案軟移動轉「放棄」；可附具名理由。
        setSkipped((prev) => new Set(prev).add(tenderId));
        setProjects((prev) =>
          prev.map((p) =>
            p.tenderId === tenderId && p.stage !== "abandoned"
              ? { ...p, stage: "abandoned", updatedAt: nowISO() }
              : p,
          ),
        );
        if (opts?.reason) setDiscardReason(tenderId, opts.reason);
        if (t) pushActivity("skip", t.title);
        postAccept(tenderId, "放棄");
        return;
      }

      if (to === "accepted") {
        // 承接：撤銷淘汰、重啟（或建立）投標專案＋看板卡。
        removeFromSkipped();
        if (t) {
          setCards((prev) =>
            prev.some((c) => c.tenderId === tenderId)
              ? prev
              : [
                  {
                    id: `k-${uid()}`,
                    tenderId,
                    title: t.title,
                    status: "todo",
                    assignee: person.id,
                    tier: t.tier,
                    deadline: t.deadline,
                  },
                  ...prev,
                ],
          );
          setProjects((prev) => {
            if (prev.some((p) => p.tenderId === tenderId)) {
              return prev.map((p) =>
                p.tenderId === tenderId && p.stage === "abandoned"
                  ? { ...p, stage: "watching", updatedAt: nowISO() }
                  : p,
              );
            }
            const ts = nowISO();
            return [
              {
                id: `p-${uid()}`,
                tenderId,
                title: t.title,
                stage: "watching",
                tier: t.tier,
                deadline: t.deadline,
                ownerId: currentMemberId,
                subtasks: [],
                notes: [],
                createdAt: ts,
                updatedAt: ts,
              },
              ...prev,
            ];
          });
          pushActivity("accept", t.title);
        }
        postAccept(tenderId, "備標中");
        return;
      }

      if (to === "starred") {
        // 收藏：撤銷淘汰並加星（不建立投標專案）。
        removeFromSkipped();
        setStarred((prev) =>
          prev.has(tenderId) ? prev : new Set(prev).add(tenderId),
        );
        postSave(tenderId, true);
        return;
      }

      // none：撤銷所有處置——移出淘汰、取消收藏（不刪專案卡，保留歷史）。
      removeFromSkipped();
      setStarred((prev) => {
        if (!prev.has(tenderId)) return prev;
        const next = new Set(prev);
        next.delete(tenderId);
        return next;
      });
      postSave(tenderId, false);
    },
    [tenders, person.id, currentMemberId, pushActivity, setDiscardReason],
  );

  // 三分判斷（需求 B/C/D/E）：✓ 可行 / ✗ 不可行 / ⭐ 精選，皆附大致原因（chips＋選填文字）。
  const verdictOf = useCallback(
    (tenderId: string): Verdict | undefined => verdicts[tenderId],
    [verdicts],
  );
  // 送判斷 → Layer B，並即時觸發 B→C 學習；回傳已落地結果＋本批學習摘要供呼叫端回饋。
  // 本地副作用維持語意一致：⭐ 精選同步收藏；✗ 不可行同步略過（移出列表）；✓/⭐ 取消先前略過。
  // 後端 /evaluate 已自行發 judgment 事件，前端不再重送以免重複計數。
  const judge = useCallback(
    (
      tenderId: string,
      verdict: Verdict,
      rationale: string,
      chips: string[],
    ): Promise<EvaluateResult | null> => {
      const t = tenders.find((x) => x.id === tenderId);
      setVerdicts((prev) => ({ ...prev, [tenderId]: verdict }));
      const featured = verdict === "featured";
      const feasible: FeasibleVerdict =
        verdict === "infeasible" ? "不可行" : "可行";
      if (verdict === "infeasible") {
        setSkipped((prev) => new Set(prev).add(tenderId));
      } else {
        setSkipped((prev) => {
          if (!prev.has(tenderId)) return prev;
          const next = new Set(prev);
          next.delete(tenderId);
          return next;
        });
      }
      if (featured) {
        setStarred((prev) =>
          prev.has(tenderId) ? prev : new Set(prev).add(tenderId),
        );
      }
      if (t) pushActivity("judge", t.title);
      // 即時 Layer B→C：負向亦即時寫團隊負權（2026-06-24 本人覆寫紅線）；失敗靜默不回滾。
      return postEvaluate(tenderId, feasible, rationale, {
        chips,
        featured,
      }).catch(() => null);
    },
    [tenders, verdicts, pushActivity],
  );

  const commentsOf = useCallback(
    (tenderId: string) =>
      comments
        .filter((c) => c.tenderId === tenderId)
        .sort((a, b) => a.at.localeCompare(b.at)),
    [comments],
  );
  const addComment = useCallback(
    (tenderId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setComments((prev) => [
        ...prev,
        {
          id: `c-${uid()}`,
          tenderId,
          userId: person.id,
          at: nowISO(),
          text: trimmed,
        },
      ]);
      const t = tenders.find((x) => x.id === tenderId);
      if (t) pushActivity("comment", t.title);
      // 行為回寫（Layer B）：註記寫回學習迴圈。
      postNote(tenderId, trimmed);
    },
    [tenders, person.id, pushActivity],
  );

  const moveCard = useCallback(
    (cardId: string, status: TaskStatus) => {
      let moved: KanbanCard | undefined;
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== cardId) return c;
          moved = c;
          return { ...c, status };
        }),
      );
      if (moved && moved.status !== status) {
        pushActivity("move", `${moved.title} → ${STATUS_LABEL_ZH[status]}`);
      }
    },
    [pushActivity],
  );

  const addCardNote = useCallback(
    (cardId: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const note: KanbanNote = {
        id: uid(),
        author: person.id,
        createdAt: nowISO(),
        body: trimmed,
      };
      let card: KanbanCard | undefined;
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== cardId) return c;
          card = c;
          return {
            ...c,
            notes: [...(c.notes ?? []), note],
          };
        }),
      );
      if (card) {
        pushActivity("comment", `「${card.title}」新增註記`);
        trackEvent("card_note_added", { payload: { cardId } });
      }
    },
    [person.id, pushActivity],
  );

  const removeCardNote = useCallback((cardId: string, noteId: string) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== cardId) return c;
        return {
          ...c,
          notes: (c.notes ?? []).filter((n) => n.id !== noteId),
        };
      }),
    );
    trackEvent("card_note_removed", { payload: { cardId, noteId } });
  }, []);

  const forwardCard = useCallback(
    (cardId: string, toUserId: string) => {
      let card: KanbanCard | undefined;
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== cardId) return c;
          card = c;
          return { ...c, assignee: toUserId };
        }),
      );
      if (card) {
        const toName = userById(toUserId)?.name ?? toUserId;
        pushActivity("move", `「${card.title}」轉傳給 ${toName}`);
        trackEvent("card_forwarded", { payload: { cardId, toUserId } });
      }
    },
    [pushActivity],
  );

  const addKeyword = useCallback(
    (list: RuleList, word: string) => {
      const w = word.trim();
      if (!w) return;
      const setter =
        list === "focus" ? setFocus : list === "avoid" ? setAvoid : setHard;
      setter((prev) => (prev.includes(w) ? prev : [...prev, w]));
      pushActivity("rule", `新增${RULE_LABEL_ZH[list]}「${w}」`);
    },
    [pushActivity],
  );
  const removeKeyword = useCallback((list: RuleList, word: string) => {
    const setter =
      list === "focus" ? setFocus : list === "avoid" ? setAvoid : setHard;
    setter((prev) => prev.filter((k) => k !== word));
  }, []);

  // ── 關鍵字進階操作（A 方案：維持 string[] 形狀） ──────────────
  // 批次新增（去重、保留既有順序、過濾空白）。
  const addKeywords = useCallback(
    (list: RuleList, words: string[]) => {
      const cleaned = words.map((w) => w.trim()).filter(Boolean);
      if (!cleaned.length) return;
      const setter =
        list === "focus" ? setFocus : list === "avoid" ? setAvoid : setHard;
      const added: string[] = [];
      setter((prev) => {
        const next = [...prev];
        for (const w of cleaned) {
          if (!next.includes(w)) {
            next.push(w);
            added.push(w);
          }
        }
        return next;
      });
      if (added.length) {
        pushActivity(
          "rule",
          `批次新增${RULE_LABEL_ZH[list]}「${added.join("、")}」`,
        );
      }
    },
    [pushActivity],
  );

  // 把一個詞從 from 清單移到 to 清單（去重）。
  const moveKeyword = useCallback(
    (from: RuleList, to: RuleList, word: string) => {
      const w = word.trim();
      if (!w || from === to) return;
      const fromSetter =
        from === "focus" ? setFocus : from === "avoid" ? setAvoid : setHard;
      const toSetter =
        to === "focus" ? setFocus : to === "avoid" ? setAvoid : setHard;
      fromSetter((prev) => prev.filter((k) => k !== w));
      toSetter((prev) => (prev.includes(w) ? prev : [...prev, w]));
      pushActivity(
        "rule",
        `「${w}」從${RULE_LABEL_ZH[from]}移到${RULE_LABEL_ZH[to]}`,
      );
    },
    [pushActivity],
  );

  // 整批取代一個清單（去重、過濾空白）。
  const replaceKeywords = useCallback(
    (list: RuleList, words: string[]) => {
      const cleaned = words.map((w) => w.trim()).filter(Boolean);
      const deduped = [...new Set(cleaned)];
      const setter =
        list === "focus" ? setFocus : list === "avoid" ? setAvoid : setHard;
      setter(() => deduped);
      pushActivity(
        "rule",
        `更新${RULE_LABEL_ZH[list]}（${deduped.length} 項）`,
      );
    },
    [pushActivity],
  );

  // 清空一個清單。
  const clearKeywords = useCallback(
    (list: RuleList) => {
      const setter =
        list === "focus" ? setFocus : list === "avoid" ? setAvoid : setHard;
      setter(() => []);
      pushActivity("rule", `清空${RULE_LABEL_ZH[list]}`);
    },
    [pushActivity],
  );

  // ── 投標看板：成員選擇器 ───────────────────────────────────────
  // allMembers＝名冊 ∪ 當前登入者（即使其不在名冊，如 mock id=0），供 memberById
  // 解析 owner／assignee 頭像；不影響 assignableMembers（指派仍嚴格限白名單）。
  const allMembers = useMemo<Member[]>(() => {
    if (!user || members.some((m) => m.id === user.id)) return members;
    const d = authDisplay({ name: user.name, email: user.email });
    const self: Member = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      whitelistActive: user.whitelistActive,
      consentShared: user.consentShared,
      initials: d.initials,
      color: d.color,
    };
    return [self, ...members];
  }, [members, user]);

  // Issue #1 指派名單唯一來源：僅白名單成員（whitelistActive）。
  const assignableMembers = useMemo<Member[]>(
    () => filterAssignableMembers(members),
    [members],
  );

  const memberById = useCallback(
    (id: number | null | undefined): Member | undefined =>
      id == null ? undefined : allMembers.find((m) => m.id === id),
    [allMembers],
  );

  // ── 投標看板：專案選擇器 ───────────────────────────────────────
  const visibleProjects = useMemo<TenderProject[]>(
    () => filterVisibleProjects(projects, boardView, currentMemberId),
    [projects, boardView, currentMemberId],
  );

  const projectsByStage = useMemo<Record<BidStage, TenderProject[]>>(() => {
    const acc: Record<BidStage, TenderProject[]> = {
      watching: [],
      preparing: [],
      submitted: [],
      won: [],
      abandoned: [],
    };
    for (const p of visibleProjects) acc[p.stage].push(p);
    return acc;
  }, [visibleProjects]);

  const subtaskProgressOf = useCallback(
    (project: TenderProject) => ({
      done: project.subtasks.filter((s) => s.status === "done").length,
      total: project.subtasks.length,
    }),
    [],
  );

  // ── 投標看板：專案行動 ─────────────────────────────────────────
  const moveProjectStage = useCallback(
    (id: string, stage: BidStage) => {
      let moved: TenderProject | undefined;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          moved = p;
          return { ...p, stage, updatedAt: nowISO() };
        }),
      );
      if (moved && moved.stage !== stage) {
        pushActivity("move", `${moved.title} → ${STAGE_LABEL_ZH[stage]}`);
      }
    },
    [pushActivity],
  );

  const addProject = useCallback(
    (input: {
      title: string;
      tenderId?: string;
      tier?: Tier;
      deadline?: string;
      stage?: BidStage;
    }) => {
      const title = input.title.trim();
      if (!title) return;
      setProjects((prev) => {
        if (input.tenderId && prev.some((p) => p.tenderId === input.tenderId))
          return prev;
        const ts = nowISO();
        const proj: TenderProject = {
          id: `p-${uid()}`,
          tenderId: input.tenderId,
          title,
          stage: input.stage ?? "watching",
          tier: input.tier,
          deadline: input.deadline,
          ownerId: currentMemberId,
          subtasks: [],
          notes: [],
          createdAt: ts,
          updatedAt: ts,
        };
        return [proj, ...prev];
      });
      pushActivity("accept", title);
    },
    [currentMemberId, pushActivity],
  );

  const updateProject = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<TenderProject, "title" | "tier" | "deadline" | "stage" | "ownerId">
      >,
    ) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, ...patch, updatedAt: nowISO() } : p,
        ),
      );
    },
    [],
  );

  const removeProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addProjectNote = useCallback(
    (projectId: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const note: KanbanNote = {
        id: uid(),
        author: currentMemberName,
        createdAt: nowISO(),
        body: trimmed,
      };
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                notes: [...(p.notes ?? []), note],
                updatedAt: nowISO(),
              }
            : p,
        ),
      );
    },
    [currentMemberName],
  );

  const removeProjectNote = useCallback((projectId: string, noteId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              notes: (p.notes ?? []).filter((n) => n.id !== noteId),
              updatedAt: nowISO(),
            }
          : p,
      ),
    );
  }, []);

  // ── 投標看板：子任務行動 ───────────────────────────────────────
  const addSubtask = useCallback(
    (
      projectId: string,
      input: {
        title: string;
        description?: string;
        assigneeId?: number | null;
        priority?: SubtaskPriority;
        dueDate?: string | null;
        tags?: string[];
      },
    ) => {
      const title = input.title.trim();
      if (!title) return;
      const st: Subtask = {
        id: `st-${uid()}`,
        title,
        description: input.description?.trim() || undefined,
        assigneeId: input.assigneeId ?? null,
        status: "todo",
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        tags: input.tags,
        createdBy: currentMemberId,
        createdAt: nowISO(),
      };
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, subtasks: [...p.subtasks, st], updatedAt: nowISO() }
            : p,
        ),
      );
    },
    [currentMemberId],
  );

  const updateSubtask = useCallback(
    (
      projectId: string,
      subtaskId: string,
      patch: Partial<
        Pick<
          Subtask,
          | "title"
          | "description"
          | "status"
          | "priority"
          | "dueDate"
          | "tags"
          | "assigneeId"
        >
      >,
    ) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                subtasks: p.subtasks.map((s) =>
                  s.id === subtaskId ? { ...s, ...patch } : s,
                ),
                updatedAt: nowISO(),
              }
            : p,
        ),
      );
    },
    [],
  );

  const assignSubtask = useCallback(
    (projectId: string, subtaskId: string, memberId: number | null) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                subtasks: p.subtasks.map((s) =>
                  s.id === subtaskId ? { ...s, assigneeId: memberId } : s,
                ),
                updatedAt: nowISO(),
              }
            : p,
        ),
      );
    },
    [],
  );

  const toggleSubtask = useCallback((projectId: string, subtaskId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              subtasks: p.subtasks.map((s) =>
                s.id === subtaskId
                  ? { ...s, status: s.status === "done" ? "todo" : "done" }
                  : s,
              ),
              updatedAt: nowISO(),
            }
          : p,
      ),
    );
  }, []);

  const removeSubtask = useCallback((projectId: string, subtaskId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              subtasks: p.subtasks.filter((s) => s.id !== subtaskId),
              updatedAt: nowISO(),
            }
          : p,
      ),
    );
  }, []);

  // ── 投標看板：成員行動（白名單治理）───────────────────────────
  const addMember = useCallback(
    (input: { name: string; email: string; role?: string }) => {
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      if (!name || !HQ_EMAIL_RE.test(email)) return; // 治理紅線：限 @hqdesign.tw
      setMembers((prev) => {
        if (prev.some((m) => m.email?.toLowerCase() === email)) return prev;
        const minId = prev.reduce((mn, m) => Math.min(mn, m.id), 0);
        const d = authDisplay({ name, email });
        const member: Member = {
          id: minId - 1, // 本地暫時負 id；live+admin hydration 以 email 併入真實 id
          name,
          email,
          role: input.role ?? "member",
          whitelistActive: false, // 治理紅線：新成員預設未開通，管理員另行開通
          consentShared: false,
          initials: d.initials,
          color: d.color,
        };
        return [...prev, member];
      });
    },
    [],
  );

  const updateMember = useCallback(
    (id: number, patch: Partial<Pick<Member, "name" | "role" | "email">>) => {
      setMembers((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const next = { ...m, ...patch };
          if (patch.name || patch.email) {
            const d = authDisplay({ name: next.name, email: next.email });
            next.initials = d.initials;
            next.color = d.color;
          }
          return next;
        }),
      );
    },
    [],
  );

  const toggleMemberWhitelist = useCallback(
    (id: number) => {
      let target: Member | undefined;
      setMembers((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          target = m;
          return { ...m, whitelistActive: !m.whitelistActive };
        }),
      );
      // 前端優先：本地已切換；live+admin 再 best-effort 同步後端（失敗不阻塞）。
      if (
        target?.email &&
        isAdmin &&
        import.meta.env.VITE_USE_API !== "false"
      ) {
        void setWhitelist(target.email, !target.whitelistActive);
      }
    },
    [isAdmin],
  );

  const removeMember = useCallback(
    (id: number) => {
      let target: Member | undefined;
      setMembers((prev) => {
        target = prev.find((m) => m.id === id);
        return prev.filter((m) => m.id !== id);
      });
      // 前端優先：本地已移除；live+admin 再把刪除落地後端（失敗不阻塞）。
      // 不落地後端，hydration 會於重整時把帳號併回（復活）——本修法的根因。
      if (
        target?.email &&
        isAdmin &&
        import.meta.env.VITE_USE_API !== "false"
      ) {
        void deleteAccount(target.email);
      }
    },
    [isAdmin],
  );

  const setBoardView = useCallback((patch: Partial<BoardView>) => {
    setBoardViewState((prev) => ({ ...prev, ...patch }));
  }, []);

  // 白名單 best-effort hydration：live+admin 時抓真實帳號，依 email 併入 members
  // （更新真實 id / whitelist / consent、剔除後端已不存在的殘留種子帳號；合併邏輯
  // 抽至 board-logic.mergeAccountsIntoMembers 以便測試）。非 admin／離線會 403／不可達
  // → 維持本地種子＋本地 CRUD（前端優先的退化路徑）。
  useEffect(() => {
    if (import.meta.env.VITE_USE_API === "false" || !isAdmin) return;
    let cancelled = false;
    fetchAccounts()
      .then((rows) => {
        if (cancelled || !rows || !rows.length) return;
        setMembers((prev) => {
          const merged = mergeAccountsIntoMembers(prev, rows);
          save("members", merged);
          return merged;
        });
      })
      .catch(() => {
        /* 後端不可達或非 admin（403）：維持本地 members */
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const value = useMemo<AppDataValue>(
    () => ({
      filter,
      setFilter,
      resetFilter,
      toggleSort,
      tenders,
      filteredTenders,
      isExcluded,
      excludeReasonOf,
      hasFocus,
      usingLiveData,
      tendersLoading,
      isStarred,
      toggleStar,
      accept,
      skip,
      isSkipped,
      isAccepted,
      dispositionOf,
      reclassify,
      discardReasonOf,
      setDiscardReason,
      verdictOf,
      judge,
      commentsOf,
      addComment,
      cards,
      moveCard,
      addCardNote,
      removeCardNote,
      forwardCard,
      activity,
      focusKeywords,
      avoidKeywords,
      hardExclude,
      addKeyword,
      removeKeyword,
      addKeywords,
      moveKeyword,
      replaceKeywords,
      clearKeywords,
      feasOf,
      keywordHitsOf,
      metrics,
      trend7d: TREND_7D,
      savedSearches,
      saveCurrentSearch,
      applySavedSearch,
      // 投標看板（Notion 式）
      currentMemberId,
      projects,
      projectsByStage,
      visibleProjects,
      moveProjectStage,
      addProject,
      updateProject,
      removeProject,
      addProjectNote,
      removeProjectNote,
      addSubtask,
      updateSubtask,
      assignSubtask,
      toggleSubtask,
      removeSubtask,
      subtaskProgressOf,
      members,
      assignableMembers,
      memberById,
      addMember,
      updateMember,
      toggleMemberWhitelist,
      removeMember,
      boardView,
      setBoardView,
    }),
    [
      filter,
      setFilter,
      resetFilter,
      toggleSort,
      tenders,
      filteredTenders,
      isExcluded,
      excludeReasonOf,
      hasFocus,
      usingLiveData,
      tendersLoading,
      isStarred,
      toggleStar,
      accept,
      skip,
      isSkipped,
      isAccepted,
      dispositionOf,
      reclassify,
      discardReasonOf,
      setDiscardReason,
      verdictOf,
      judge,
      commentsOf,
      addComment,
      cards,
      moveCard,
      addCardNote,
      removeCardNote,
      forwardCard,
      activity,
      focusKeywords,
      avoidKeywords,
      hardExclude,
      addKeyword,
      removeKeyword,
      addKeywords,
      moveKeyword,
      replaceKeywords,
      clearKeywords,
      feasOf,
      keywordHitsOf,
      metrics,
      savedSearches,
      saveCurrentSearch,
      applySavedSearch,
      currentMemberId,
      projects,
      projectsByStage,
      visibleProjects,
      moveProjectStage,
      addProject,
      updateProject,
      removeProject,
      addProjectNote,
      removeProjectNote,
      addSubtask,
      updateSubtask,
      assignSubtask,
      toggleSubtask,
      removeSubtask,
      subtaskProgressOf,
      members,
      assignableMembers,
      memberById,
      addMember,
      updateMember,
      toggleMemberWhitelist,
      removeMember,
      boardView,
      setBoardView,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData 必須在 <AppDataProvider> 內使用");
  return ctx;
}
