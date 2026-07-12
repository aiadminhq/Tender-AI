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
  Comment,
  FilterState,
  KanbanCard,
  SavedSearch,
  SortKey,
  TaskStatus,
  Tender,
} from "@/types/domain";
import { TENDERS } from "@/data/tenders";
import { KANBAN_CARDS } from "@/data/kanban";
import { ACTIVITY } from "@/data/activity";
import {
  fetchTenders,
  postAccept,
  postNote,
  postSave,
  fetchSavedSearches,
  postSavedSearch,
} from "@/lib/api";
import { trackEvent } from "@/lib/events";
import { load, save } from "@/lib/storage";
import { daysLeft } from "@/lib/format";
import { keywordHits } from "@/lib/keyword-hits";
import {
  computeFeasibility,
  type FeasResult,
  type FeasLabels,
} from "@/lib/feasibility";
import { NORTH_CITIES, serializeFilter, parseFilter } from "@/lib/url-filter";
import { useApp } from "@/store/app-context";

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
  maxBudget: null,
  focusOnly: false,
  hideExcluded: true,
  sort: "score",
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
function comparator(sort: SortKey): (a: Tender, b: Tender) => number {
  switch (sort) {
    case "deadline":
      return (a, b) => a.deadline.localeCompare(b.deadline);
    case "budget":
      return (a, b) => b.budget - a.budget;
    case "feasibility":
      return (a, b) => b.feasibility - a.feasibility;
    case "score":
    default:
      return (a, b) => a.score - b.score;
  }
}

export interface Metrics {
  kpiNew: number;
  kpiHigh: number;
  kpiClosing: number;
  kpiInProgress: number;
  kpiAccepted: number;
}

interface AppDataValue {
  // 篩選
  filter: FilterState;
  setFilter: (patch: Partial<FilterState>) => void;
  resetFilter: () => void;
  // 標案
  tenders: Tender[];
  filteredTenders: Tender[];
  isExcluded: (t: Tender) => boolean;
  excludeReasonOf: (t: Tender) => string | undefined;
  hasFocus: (t: Tender) => boolean;
  // 資料來源狀態：true=後端真實資料、false=mock fallback
  usingLiveData: boolean;
  // 星號
  isStarred: (tenderId: string) => boolean;
  toggleStar: (tenderId: string) => void;
  // 行動
  accept: (tenderId: string) => void;
  skip: (tenderId: string) => void;
  // 註記
  commentsOf: (tenderId: string) => Comment[];
  addComment: (tenderId: string, text: string) => void;
  // 看板
  cards: KanbanCard[];
  moveCard: (cardId: string, status: TaskStatus) => void;
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
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { person } = useApp();

  // 後端對接：初始為 mock，掛載後抓真實標案；失敗則維持 mock，不中斷 UI。
  const [tenders, setTenders] = useState<Tender[]>(TENDERS);
  const [usingLiveData, setUsingLiveData] = useState(false);
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
      });
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
  const [focusKeywords, setFocus] = useState<string[]>(() =>
    load("rules:focus", DEFAULT_FOCUS),
  );
  const [avoidKeywords, setAvoid] = useState<string[]>(() =>
    load("rules:avoid", DEFAULT_AVOID),
  );
  const [hardExclude, setHard] = useState<string[]>(() =>
    load("rules:hard", DEFAULT_HARD),
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
  useEffect(() => save("rules:focus", focusKeywords), [focusKeywords]);
  useEffect(() => save("rules:avoid", avoidKeywords), [avoidKeywords]);
  useEffect(() => save("rules:hard", hardExclude), [hardExclude]);

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
      if (filter.maxBudget != null && t.budget > filter.maxBudget) return false;
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
      return list.sort((a, b) => feasOf(b).score - feasOf(a).score);
    }
    return list.sort(comparator(filter.sort));
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
      ? visible.filter(
          (t) => (t.lastSeen ?? t.publishedAt ?? "").slice(0, 10) === latest,
        ).length
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
            maxBudget: next.maxBudget,
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
      // filter 存整份 FilterState，setFilter 以 patch 覆蓋全鍵 → 等同完整套用。
      if (found) setFilter(found.filter);
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
      pushActivity("accept", t.title);
      // 行為回寫（Layer B）：承接 → 後端標記備標中。
      postAccept(tenderId, "備標中");
    },
    [tenders, person.id, pushActivity],
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

  const value = useMemo<AppDataValue>(
    () => ({
      filter,
      setFilter,
      resetFilter,
      tenders,
      filteredTenders,
      isExcluded,
      excludeReasonOf,
      hasFocus,
      usingLiveData,
      isStarred,
      toggleStar,
      accept,
      skip,
      commentsOf,
      addComment,
      cards,
      moveCard,
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
    }),
    [
      filter,
      setFilter,
      resetFilter,
      tenders,
      filteredTenders,
      isExcluded,
      excludeReasonOf,
      hasFocus,
      usingLiveData,
      isStarred,
      toggleStar,
      accept,
      skip,
      commentsOf,
      addComment,
      cards,
      moveCard,
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
