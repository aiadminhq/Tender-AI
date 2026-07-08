/* Tender AI — 操作面板組件庫（Ops Panels showcase）
   忠實移植自 Claude Design 專案 templates/ops-panels/OpsPanels.dc.html ＋
   templates/ops-dashboard/dashboard.jsx 的 window.OpsPanels 七面板。
   作法對齊 /knowvio 先例：獨立全螢幕路由、本地 TX 字典＋useApp().lang、
   保留來源的 inline style ＋真實 CSS-var tokens（深淺色自動適配），
   並改用本專案真實的 @/components/ui 元件取代 window.TenderUI。 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { useApp } from "@/store/app-context";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import { TierBadge } from "@/components/ui/tier-badge";
import { BarSpark, LineSpark } from "@/components/ui/sparkline";
import { TrendBadge } from "@/components/ui/trend-badge";
import { Select } from "@/components/ui/select";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AnnotationToggle } from "@/components/annotate/annotation-toggle";
import type { Tier } from "@/types/domain";
import type { Lang } from "@/i18n/strings";

const mono: CSSProperties = {
  fontFamily: "'JetBrains Mono','SF Mono',ui-monospace,monospace",
};

/* ----------------------------------------------------------------- i18n */
const STR = {
  zh: {
    brand: "Tender AI",
    brandSub: "標案智選",
    search: "搜尋標案、機關、案號…",
    profileRole: "標案承辦團隊",
    navHome: "營運總覽",
    navHunt: "標案探勘",
    navDispatch: "派發管理",
    navTeam: "團隊",
    navReport: "報表",
    addWidget: "新增面板",
    settings: "設定",
    collapse: "收合",
    tasks: "我的任務",
    tasksSub: "待辦與派發",
    addTask: "新增任務",
    sortBy: "排序",
    deadline: "截止",
    urgent: "緊急",
    normal: "一般",
    done: "已完成",
    activity: "事件紀錄",
    activitySub: "Activity manager",
    searchAct: "搜尋活動…",
    allAct: "全部活動",
    filters: "篩選",
    dispatch: "專案派發",
    dispatchSub: "把標案指派給團隊",
    assign: "指派",
    assignTo: "指派給…",
    assigned: "已指派",
    recall: "收回",
    featured: "精選案件",
    newTenders: "今日新進",
    cases: "件",
    avgFeas: "平均可行度",
    stats: "資料統計",
    statsSub: "本月關鍵指標",
    bidCount: "投標件數",
    winRate: "得標率",
    lastWeeks: "近 7 週投標 vs 得標",
    won: "得標",
    submitted: "投標",
    teamLoad: "團隊負載",
    teamLoadSub: "成員手上案件與進度",
    active: "進行中",
    full: "滿載",
    available: "可接案",
    budget: "預算",
    due: "截止收件",
    feas: "可行度",
    openBid: "公開招標",
    wallTitle: "操作面板組件庫",
    wallSub: "以 Tender AI 設計系統構築的營運操作面板組",
  },
  en: {
    brand: "Tender AI",
    brandSub: "Smart bid picks",
    search: "Search tenders, agencies, IDs…",
    profileRole: "Bid desk team",
    navHome: "Overview",
    navHunt: "Discover",
    navDispatch: "Dispatch",
    navTeam: "Team",
    navReport: "Reports",
    addWidget: "Add panel",
    settings: "Settings",
    collapse: "Collapse",
    tasks: "My tasks",
    tasksSub: "To-do & dispatch",
    addTask: "Add task",
    sortBy: "Sort",
    deadline: "Deadline",
    urgent: "Urgent",
    normal: "Normal",
    done: "Done",
    activity: "Activity",
    activitySub: "Activity manager",
    searchAct: "Search activities…",
    allAct: "All activities",
    filters: "Filters",
    dispatch: "Dispatch",
    dispatchSub: "Assign tenders to the team",
    assign: "Assign",
    assignTo: "Assign to…",
    assigned: "Assigned",
    recall: "Recall",
    featured: "Featured",
    newTenders: "New today",
    cases: "",
    avgFeas: "Avg feasibility",
    stats: "Statistics",
    statsSub: "Key metrics this month",
    bidCount: "Bids filed",
    winRate: "Win rate",
    lastWeeks: "Bids vs wins · 7 wks",
    won: "Won",
    submitted: "Filed",
    teamLoad: "Team load",
    teamLoadSub: "Caseload & progress",
    active: "active",
    full: "Full",
    available: "Open",
    budget: "Budget",
    due: "Due",
    feas: "Feasibility",
    openBid: "Open tender",
    wallTitle: "Operation panels",
    wallSub: "Reusable ops panels built from the Tender AI design system",
  },
} satisfies Record<Lang, Record<string, string>>;

type Tx = (typeof STR)["zh"];

/* ----------------------------------------------------------------- data */
type Member = {
  id: string;
  name: string;
  en: string;
  initials: string;
  role: { zh: string; en: string };
  color: string;
};
type Tender = {
  id: string;
  title: { zh: string; en: string };
  agency: { zh: string; en: string };
  cat: { zh: string; en: string };
  budget: number;
  due: string;
  feas: number;
  tier: Tier;
  featured: boolean;
  assignedTo: string | null;
};
type Task = {
  id: string;
  title: { zh: string; en: string };
  owner: string;
  deadline: string;
  urgent: boolean;
  done: boolean;
};
type ActType = "feas" | "favorite" | "assign" | "reject" | "deadline";
type Act = {
  id: string;
  type: ActType;
  actor: string;
  text: { zh: string; en: string };
  tag: { zh: string; en: string } | null;
  time: string;
};

const MEMBERS: Record<string, Member> = {
  m1: {
    id: "m1",
    name: "林宜蓁",
    en: "Yi-Chen Lin",
    initials: "宜",
    role: { zh: "專案經理", en: "Project Lead" },
    color: "oklch(66% .15 37)",
  },
  m2: {
    id: "m2",
    name: "王建豪",
    en: "Jian-Hao Wang",
    initials: "建",
    role: { zh: "結構技師", en: "Structural Eng." },
    color: "oklch(64% .13 250)",
  },
  m3: {
    id: "m3",
    name: "陳美如",
    en: "Mei-Ru Chen",
    initials: "美",
    role: { zh: "法務專員", en: "Legal" },
    color: "oklch(66% .13 162)",
  },
  m4: {
    id: "m4",
    name: "吳　俊",
    en: "Jun Wu",
    initials: "俊",
    role: { zh: "估價師", en: "Estimator" },
    color: "oklch(0.5553 0.1455 48.9975)",
  },
  m5: {
    id: "m5",
    name: "張庭瑋",
    en: "Ting-Wei Chang",
    initials: "庭",
    role: { zh: "業務開發", en: "BizDev" },
    color: "oklch(68% .13 92)",
  },
};
const MLIST = Object.values(MEMBERS);
const nameOf = (m: Member, lang: Lang) => (lang === "en" ? m.en : m.name);

const SEED_TENDERS: Tender[] = [
  {
    id: "t1",
    title: {
      zh: "臺北市立大同國小校舍耐震補強統包工程",
      en: "Datong Elementary seismic retrofit (turnkey)",
    },
    agency: { zh: "臺北市教育局", en: "Taipei Education Dept." },
    cat: { zh: "營繕工程", en: "Construction" },
    budget: 28500000,
    due: "2026/07/18",
    feas: 88,
    tier: "high",
    featured: true,
    assignedTo: "m1",
  },
  {
    id: "t2",
    title: {
      zh: "智慧路燈與交通號誌整合建置案",
      en: "Smart streetlight & signal integration",
    },
    agency: { zh: "臺北市交通局", en: "Taipei Transport Dept." },
    cat: { zh: "資訊服務", en: "IT services" },
    budget: 45800000,
    due: "2026/08/12",
    feas: 81,
    tier: "high",
    featured: true,
    assignedTo: null,
  },
  {
    id: "t3",
    title: {
      zh: "市立圖書館中央空調系統汰換更新",
      en: "City library HVAC replacement",
    },
    agency: { zh: "臺北市文化局", en: "Taipei Culture Dept." },
    cat: { zh: "財物採購", en: "Procurement" },
    budget: 12400000,
    due: "2026/07/05",
    feas: 74,
    tier: "mid",
    featured: false,
    assignedTo: "m2",
  },
  {
    id: "t4",
    title: {
      zh: "市民運動中心泳池設備維護案",
      en: "Sports center pool equipment upkeep",
    },
    agency: { zh: "臺北市體育局", en: "Taipei Sports Dept." },
    cat: { zh: "財物採購", en: "Procurement" },
    budget: 2900000,
    due: "2026/07/22",
    feas: 66,
    tier: "mid",
    featured: false,
    assignedTo: null,
  },
  {
    id: "t5",
    title: {
      zh: "區公所辦公廳舍清潔勞務委託",
      en: "District office cleaning services",
    },
    agency: { zh: "中正區公所", en: "Zhongzheng Office" },
    cat: { zh: "勞務委託", en: "Services" },
    budget: 3200000,
    due: "2026/06/30",
    feas: 58,
    tier: "mid",
    featured: false,
    assignedTo: null,
  },
  {
    id: "t6",
    title: { zh: "偏遠道路路面整修工程", en: "Rural road resurfacing" },
    agency: { zh: "臺北市工務局", en: "Public Works Dept." },
    cat: { zh: "營繕工程", en: "Construction" },
    budget: 6700000,
    due: "2026/07/01",
    feas: 34,
    tier: "low",
    featured: false,
    assignedTo: null,
  },
];

const SEED_TASKS: Task[] = [
  {
    id: "k1",
    title: {
      zh: "送出大同國小案投標文件",
      en: "File Datong Elementary bid docs",
    },
    owner: "m1",
    deadline: "2026/07/15",
    urgent: true,
    done: false,
  },
  {
    id: "k2",
    title: {
      zh: "確認智慧路燈案押標金額度",
      en: "Confirm streetlight bid bond",
    },
    owner: "m4",
    deadline: "2026/07/20",
    urgent: false,
    done: false,
  },
  {
    id: "k3",
    title: {
      zh: "圖書館空調案現場勘查排程",
      en: "Schedule library HVAC site visit",
    },
    owner: "m2",
    deadline: "2026/07/02",
    urgent: false,
    done: false,
  },
  {
    id: "k4",
    title: {
      zh: "彙整大同國小耐震補強實績附件",
      en: "Compile retrofit track-record annex",
    },
    owner: "m3",
    deadline: "2026/07/10",
    urgent: false,
    done: true,
  },
];

const ACT_ICON: Record<ActType, string> = {
  assign: "userplus",
  feas: "gauge",
  favorite: "star",
  reject: "ban",
  deadline: "hourglass",
};
const SEED_ACT: Act[] = [
  {
    id: "a1",
    type: "feas",
    actor: "m1",
    text: {
      zh: "將大同國小案可行度評為 88（高潛力）",
      en: "Rated Datong case feasibility 88 (high)",
    },
    tag: { zh: "營繕工程", en: "Construction" },
    time: "10:24",
  },
  {
    id: "a2",
    type: "favorite",
    actor: "m5",
    text: {
      zh: "收藏智慧路燈整合建置案",
      en: "Favorited smart streetlight case",
    },
    tag: { zh: "資訊服務", en: "IT" },
    time: "09:51",
  },
  {
    id: "a3",
    type: "assign",
    actor: "m1",
    text: {
      zh: "指派圖書館空調案給 王建豪",
      en: "Assigned library HVAC to Jian-Hao",
    },
    tag: null,
    time: "09:30",
  },
  {
    id: "a4",
    type: "reject",
    actor: "m4",
    text: {
      zh: "標記偏遠道路整修案為不可行",
      en: "Marked rural road case infeasible",
    },
    tag: { zh: "營繕工程", en: "Construction" },
    time: "Yesterday",
  },
  {
    id: "a5",
    type: "deadline",
    actor: "m3",
    text: {
      zh: "區公所清潔案將於 3 日後截止",
      en: "District cleaning case closes in 3 days",
    },
    tag: null,
    time: "Yesterday",
  },
];

const ACCENT_SOFT = "color-mix(in oklab, var(--signal) 12%, transparent)";

/* ----------------------------------------------------------------- atoms */
const fmtNT = (n: number) => "NT$ " + n.toLocaleString("en-US");

function Ico({
  d,
  size = 18,
  sw = 1.8,
}: {
  d: string[];
  size?: number;
  sw?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

const ICON: Record<string, string[]> = {
  search: ["M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-4.3-4.3"],
  plus: ["M12 5v14", "M5 12h14"],
  filter: ["M4 5h16", "M7 12h10", "M10 19h4"],
  dots: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  bell: ["M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6", "M10 20a2 2 0 0 0 4 0"],
  calendar: [
    "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
    "M4 9h16",
    "M9 3v3",
    "M15 3v3",
  ],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 6 7l-.1-.1A2 2 0 1 1 8.7 4.1l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17 6l.1-.1a2 2 0 1 1 2.8 2.8L19.8 9a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  ],
  chevron: ["M6 9l6 6 6-6"],
  check: ["M5 12l5 5L20 6"],
  layout: [
    "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
    "M4 10h16",
    "M10 10v10",
  ],
  x: ["M6 6l12 12", "M18 6L6 18"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  users: [
    "M16 19a4 4 0 0 0-8 0",
    "M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M21 19a3 3 0 0 0-5-2.2",
    "M17 11a2.5 2.5 0 0 0 0-5",
  ],
  clock: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 7v5l3 2"],
  share: [
    "M6 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M18 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M8 11l8-4",
    "M8 13l8 4",
  ],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  home: ["M4 11l8-7 8 7", "M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"],
  compass: [
    "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M15 9l-2 5-4 2 2-5z",
  ],
  send: ["M4 12l16-7-7 16-2-7z"],
  chart: ["M4 19V5", "M4 19h16", "M8 16v-4", "M12 16V9", "M16 16v-7"],
  star: [
    "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  ],
  ban: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M6 6l12 12"],
  gauge: [
    "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
    "M13.6 10.4L17 7",
    "M4 18a8 8 0 1 1 16 0",
  ],
  hourglass: ["M6 3h12", "M6 21h12", "M8 3v4l4 4 4-4V3", "M8 21v-4l4-4 4 4v4"],
  userplus: [
    "M13 19a4 4 0 0 0-8 0",
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M18 8v6",
    "M15 11h6",
  ],
  trending: ["M3 17l6-6 4 4 7-7", "M14 8h6v6"],
  inbox: [
    "M4 13l2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
    "M4 13h4a2 2 0 0 0 8 0h4",
  ],
  sparkles: [
    "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z",
    "M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  ],
};

function IconBtn({
  name,
  label,
  onClick,
  size = 36,
  active,
}: {
  name: string;
  label: string;
  onClick?: () => void;
  size?: number;
  active?: boolean;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        border: "1px solid var(--hairline)",
        cursor: "pointer",
        background: active
          ? ACCENT_SOFT
          : h
            ? "var(--surface-2)"
            : "var(--surface-1)",
        color: active ? "var(--signal)" : "var(--ink-muted)",
        transition: "background .15s,color .15s",
      }}
    >
      <Ico d={ICON[name]} size={18} />
    </button>
  );
}

function Chip({
  children,
  onRemove,
  dot,
}: {
  children: ReactNode;
  onRemove?: () => void;
  dot?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 10px",
        borderRadius: 999,
        border: "1px solid var(--hairline)",
        background: "var(--surface-1)",
        fontSize: 12.5,
        color: "var(--ink)",
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: "var(--signal)",
          }}
        />
      )}
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="remove"
          style={{
            border: 0,
            background: "none",
            cursor: "pointer",
            color: "var(--ink-muted)",
            display: "inline-flex",
            padding: 0,
            marginLeft: 1,
          }}
        >
          <Ico d={ICON.x} size={13} sw={2} />
        </button>
      )}
    </span>
  );
}

function Panel({
  title,
  subtitle,
  actions,
  children,
  style,
  pad,
  icon,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  pad?: number | string;
  icon?: string;
}) {
  return (
    <section
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--panel-radius,16px)",
        boxShadow: "var(--panel-shadow,0 1px 2px rgba(0,0,0,.06))",
        padding: pad ?? "var(--panel-pad,20px)",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        breakInside: "avoid",
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {icon && (
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: ACCENT_SOFT,
                  color: "var(--signal)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Ico d={ICON[icon]} size={16} />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: "-.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {title}
              </h3>
              {subtitle && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-muted)",
                    marginTop: 1,
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          {actions && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              {actions}
            </div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

function Ring({
  value,
  label,
  sub,
}: {
  value: number;
  label: string;
  sub?: string;
}) {
  const deg = Math.round(value * 3.6);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background: `conic-gradient(var(--signal) ${deg}deg, var(--surface-2) ${deg}deg)`,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 999,
            background: "var(--surface-1)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              ...mono,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            {value}%
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- panels */

// 01 我的任務 / 待辦派發
function TaskPanel({
  lang,
  tasks: cTasks,
  onToggle: cToggle,
}: {
  lang: Lang;
  tasks?: Task[];
  onToggle?: (id: string) => void;
}) {
  const t: Tx = STR[lang];
  const [uTasks, setU] = useState<Task[]>(SEED_TASKS);
  const tasks = cTasks ?? uTasks;
  const toggle = (id: string) =>
    cToggle
      ? cToggle(id)
      : setU((p) => p.map((k) => (k.id === id ? { ...k, done: !k.done } : k)));
  return (
    <Panel
      title={t.tasks}
      subtitle={t.tasksSub}
      icon="inbox"
      actions={
        <>
          <Chip dot>
            {t.sortBy}: {lang === "en" ? "Deadline" : "截止日"}
          </Chip>
          <Button variant="primary" size="sm">
            + {t.addTask}
          </Button>
        </>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
          gap: 12,
        }}
      >
        {tasks.map((k) => {
          const m = MEMBERS[k.owner];
          return (
            <div
              key={k.id}
              style={{
                background: "var(--surface-2)",
                borderRadius: 14,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
              >
                <button
                  onClick={() => toggle(k.id)}
                  aria-label="toggle"
                  style={{
                    flexShrink: 0,
                    marginTop: 1,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    cursor: "pointer",
                    border: k.done ? "0" : "1.6px solid var(--ink-muted)",
                    background: k.done ? "var(--signal)" : "transparent",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {k.done && <Ico d={ICON.check} size={12} sw={3} />}
                </button>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.35,
                    color: "var(--ink)",
                    textDecoration: k.done ? "line-through" : "none",
                    opacity: k.done ? 0.55 : 1,
                  }}
                >
                  {k.title[lang]}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-muted)",
                      marginBottom: 3,
                    }}
                  >
                    {t.deadline}
                  </div>
                  <div style={{ ...mono, fontSize: 12, color: "var(--ink)" }}>
                    {k.deadline}
                  </div>
                </div>
                {k.done ? (
                  <Badge variant="success">{t.done}</Badge>
                ) : k.urgent ? (
                  <Badge variant="signal">{t.urgent}</Badge>
                ) : (
                  <Badge variant="muted">{t.normal}</Badge>
                )}
                <Avatar
                  user={{
                    name: nameOf(m, lang),
                    initials: m.initials,
                    color: m.color,
                  }}
                  size="md"
                />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// 02 專案派發 / 團隊指派
function DispatchPanel({
  lang,
  tenders: cTen,
  members = MLIST,
  onAssign: cAssign,
  onRecall: cRecall,
}: {
  lang: Lang;
  tenders?: Tender[];
  members?: Member[];
  onAssign?: (id: string, mid: string) => void;
  onRecall?: (id: string) => void;
}) {
  const t: Tx = STR[lang];
  const [uTen, setU] = useState<Tender[]>(SEED_TENDERS);
  const tenders = cTen ?? uTen;
  const [pick, setPick] = useState<Record<string, string>>({});
  const assign = (id: string, mid: string) => {
    if (!mid) return;
    cAssign
      ? cAssign(id, mid)
      : setU((p) =>
          p.map((x) => (x.id === id ? { ...x, assignedTo: mid } : x)),
        );
    setPick((p) => ({ ...p, [id]: "" }));
  };
  const recall = (id: string) =>
    cRecall
      ? cRecall(id)
      : setU((p) =>
          p.map((x) => (x.id === id ? { ...x, assignedTo: null } : x)),
        );
  const opts = [
    { value: "", label: t.assignTo },
    ...members.map((m) => ({
      value: m.id,
      label: nameOf(m, lang) + " · " + m.role[lang],
    })),
  ];
  return (
    <Panel title={t.dispatch} subtitle={t.dispatchSub} icon="send">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tenders.slice(0, 5).map((tn) => {
          const m = tn.assignedTo ? MEMBERS[tn.assignedTo] : null;
          return (
            <div
              key={tn.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: 12,
                background: "var(--surface-2)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    marginBottom: 4,
                  }}
                >
                  <TierBadge tier={tn.tier} lang={lang} />
                  <span
                    style={{
                      ...mono,
                      fontSize: 11.5,
                      color: "var(--ink-muted)",
                    }}
                  >
                    {fmtNT(tn.budget)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tn.title[lang]}
                </div>
              </div>
              {m ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar
                    user={{
                      name: nameOf(m, lang),
                      initials: m.initials,
                      color: m.color,
                    }}
                    size="md"
                    ring
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: "var(--ink-muted)" }}>
                      {t.assigned}
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      {nameOf(m, lang)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => recall(tn.id)}
                  >
                    {t.recall}
                  </Button>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: "0 1 320px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <Select
                      value={pick[tn.id] || ""}
                      onValueChange={(v) =>
                        setPick((p) => ({ ...p, [tn.id]: v }))
                      }
                      options={opts}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!pick[tn.id]}
                    onClick={() => assign(tn.id, pick[tn.id])}
                  >
                    {t.assign}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// 03 事件紀錄 / Activity manager
function ActivityPanel({
  lang,
  activities: cAct,
}: {
  lang: Lang;
  activities?: Act[];
}) {
  const t: Tx = STR[lang];
  const acts = cAct ?? SEED_ACT;
  const [chips, setChips] = useState<string[]>(["team", "insights", "today"]);
  const labels: Record<string, { zh: string; en: string }> = {
    team: { zh: "團隊", en: "Team" },
    insights: { zh: "洞察", en: "Insights" },
    today: { zh: "今日", en: "Today" },
  };
  const [q, setQ] = useState("");
  const shown = acts.filter(
    (a) => !q || a.text[lang].toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Panel
      title={t.activity}
      subtitle={t.activitySub}
      icon="clock"
      actions={
        <>
          <IconBtn name="dots" label="more" />
          <Button variant="outline" size="sm">
            {t.allAct}
          </Button>
          <Button variant="secondary" size="sm">
            <Ico d={ICON.filter} size={14} /> {t.filters}
          </Button>
        </>
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
          <span
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--ink-muted)",
              display: "inline-flex",
            }}
          >
            <Ico d={ICON.search} size={15} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.searchAct}
            style={{
              width: "100%",
              height: 38,
              paddingLeft: 32,
              paddingRight: 12,
              borderRadius: 999,
              border: "1px solid var(--hairline)",
              background: "var(--surface-2)",
              color: "var(--ink)",
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chips.map((c) => (
            <Chip
              key={c}
              dot={c === "team"}
              onRemove={
                c !== "team"
                  ? () => setChips((p) => p.filter((x) => x !== c))
                  : undefined
              }
            >
              {labels[c][lang]}
            </Chip>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((a, i) => {
          const m = MEMBERS[a.actor];
          return (
            <div
              key={a.id}
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 0",
                borderTop: i === 0 ? "0" : "1px solid var(--hairline)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    background:
                      a.type === "reject"
                        ? "color-mix(in oklab,var(--danger) 14%,transparent)"
                        : a.type === "favorite"
                          ? "color-mix(in oklab,oklch(68% .13 92) 16%,transparent)"
                          : ACCENT_SOFT,
                    color:
                      a.type === "reject"
                        ? "var(--danger)"
                        : a.type === "favorite"
                          ? "oklch(60% .13 92)"
                          : "var(--signal)",
                  }}
                >
                  <Ico d={ICON[ACT_ICON[a.type]]} size={16} />
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    color: "var(--ink)",
                    lineHeight: 1.4,
                  }}
                >
                  {a.text[lang]}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 5,
                  }}
                >
                  <Avatar
                    user={{
                      name: nameOf(m, lang),
                      initials: m.initials,
                      color: m.color,
                    }}
                    size="sm"
                  />
                  <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
                    {nameOf(m, lang)}
                  </span>
                  {a.tag && <Badge variant="outline">{a.tag[lang]}</Badge>}
                  <span
                    style={{
                      ...mono,
                      fontSize: 11,
                      color: "var(--ink-muted)",
                      marginLeft: "auto",
                    }}
                  >
                    {a.time}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// 04 標案功能卡片組
function TenderCardsPanel({
  lang,
  tenders = SEED_TENDERS,
}: {
  lang: Lang;
  tenders?: Tender[];
}) {
  const t: Tx = STR[lang];
  const featured = tenders.find((x) => x.featured) || tenders[0];
  const newCount = tenders.length;
  const avg = Math.round(
    tenders.reduce((s, x) => s + x.feas, 0) / tenders.length,
  );
  return (
    <div style={{ display: "grid", gap: "var(--panel-gap,16px)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--panel-gap,16px)",
        }}
      >
        <Panel pad={16} style={{ justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
            {t.newTenders}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                ...mono,
                fontSize: 38,
                fontWeight: 700,
                color: "var(--ink)",
                lineHeight: 1,
              }}
            >
              {newCount}
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
              {t.cases}
            </span>
          </div>
          <div>
            <Badge variant="signal">
              ⭐ {tenders.filter((x) => x.featured).length} {t.featured}
            </Badge>
          </div>
        </Panel>
        <Panel pad={16} style={{ justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
            {t.avgFeas}
          </div>
          <div
            style={{
              ...mono,
              fontSize: 38,
              fontWeight: 700,
              color: "var(--ink)",
              lineHeight: 1,
            }}
          >
            {avg}
          </div>
          <FeasibilityMeter value={avg} />
        </Panel>
      </div>
      <Panel
        title={t.featured}
        icon="sparkles"
        actions={<TierBadge tier={featured.tier} lang={lang} />}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <Badge variant="signal">⭐ {t.featured}</Badge>
          <Badge variant="default">{featured.cat[lang]}</Badge>
          <Badge variant="outline">{t.openBid}</Badge>
        </div>
        <div
          style={{
            fontSize: 15.5,
            fontWeight: 600,
            color: "var(--ink)",
            lineHeight: 1.4,
            marginBottom: 4,
          }}
        >
          {featured.title[lang]}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--ink-muted)",
            marginBottom: 14,
          }}
        >
          {featured.agency[lang]}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-muted)",
                marginBottom: 3,
              }}
            >
              {t.budget}
            </div>
            <div
              style={{
                ...mono,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              {fmtNT(featured.budget)}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-muted)",
                marginBottom: 3,
              }}
            >
              {t.due}
            </div>
            <div
              style={{
                ...mono,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              {featured.due}
            </div>
          </div>
        </div>
        <div
          style={{ fontSize: 11.5, color: "var(--ink-muted)", marginBottom: 6 }}
        >
          {t.feas} {featured.feas}
        </div>
        <FeasibilityMeter value={featured.feas} showLabel />
      </Panel>
    </div>
  );
}

// 05 資料統計卡
function StatsPanel({ lang }: { lang: Lang }) {
  const t: Tx = STR[lang];
  const kpis = [
    {
      label: t.bidCount,
      value: "18",
      delta: 12,
      spark: <BarSpark data={[4, 6, 5, 8, 7, 9, 6, 11]} />,
    },
    {
      label: t.avgFeas,
      value: "71",
      delta: 6,
      spark: <LineSpark data={[58, 62, 60, 67, 64, 70, 71]} />,
    },
  ];
  return (
    <Panel
      title={t.stats}
      subtitle={t.statsSub}
      icon="trending"
      actions={
        <Button variant="outline" size="sm">
          {lang === "en" ? "Monthly" : "本月"}{" "}
          <Ico d={ICON.chevron} size={14} />
        </Button>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: "var(--surface-2)",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
                {k.label}
              </span>
              <TrendBadge delta={k.delta} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  ...mono,
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--ink)",
                }}
              >
                {k.value}
              </span>
              <div style={{ width: 72, height: 30, color: "var(--signal)" }}>
                {k.spark}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <Ring
          value={42}
          label={t.winRate}
          sub={lang === "en" ? "8 of 19 bids" : "19 案中 8 件得標"}
        />
        <div style={{ flex: "1 1 200px", minWidth: 180 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-muted)",
              marginBottom: 10,
            }}
          >
            {t.lastWeeks}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              height: 90,
            }}
          >
            {[
              { s: 70, w: 30 },
              { s: 55, w: 22 },
              { s: 82, w: 48 },
              { s: 90, w: 40 },
              { s: 76, w: 52 },
              { s: 60, w: 30 },
              { s: 84, w: 46 },
            ].map((b, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: 3,
                  height: "100%",
                }}
              >
                <div
                  style={{
                    height: b.s + "%",
                    background: "var(--signal)",
                    borderRadius: 5,
                    opacity: 0.9,
                  }}
                />
                <div
                  style={{
                    height: b.w + "%",
                    background: "var(--surface-3,var(--surface-2))",
                    border: "1px solid var(--hairline)",
                    borderRadius: 5,
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: "var(--ink-muted)",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: "var(--signal)",
                }}
              />
              {t.submitted}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: "var(--ink-muted)",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  border: "1px solid var(--hairline)",
                  background: "var(--surface-2)",
                }}
              />
              {t.won}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// 06 團隊負載 / 成員管理
function TeamLoadPanel({
  lang,
  load: cLoad,
  members = MLIST,
}: {
  lang: Lang;
  load?: Record<string, number>;
  members?: Member[];
}) {
  const t: Tx = STR[lang];
  const base: Record<string, number> = { m1: 4, m2: 3, m3: 2, m4: 5, m5: 1 };
  const load = cLoad ?? base;
  const cap = 5;
  return (
    <Panel
      title={t.teamLoad}
      subtitle={t.teamLoadSub}
      icon="users"
      actions={<IconBtn name="plus" label="add member" />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {members.map((m) => {
          const n = load[m.id] ?? 0;
          const pct = Math.min(100, Math.round((n / cap) * 100));
          const stat: { v: BadgeProps["variant"]; l: string } =
            n >= cap
              ? { v: "danger", l: t.full }
              : n >= 3
                ? { v: "signal", l: t.active }
                : { v: "success", l: t.available };
          return (
            <div
              key={m.id}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <Avatar
                user={{
                  name: nameOf(m, lang),
                  initials: m.initials,
                  color: m.color,
                }}
                size="lg"
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 5,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {nameOf(m, lang)}{" "}
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 400,
                        color: "var(--ink-muted)",
                      }}
                    >
                      · {m.role[lang]}
                    </span>
                  </span>
                  <span
                    style={{ ...mono, fontSize: 12, color: "var(--ink-muted)" }}
                  >
                    {n}/{cap}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 99,
                    background: "var(--surface-2)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: pct + "%",
                      height: "100%",
                      borderRadius: 99,
                      background: n >= cap ? "var(--danger)" : "var(--signal)",
                    }}
                  />
                </div>
              </div>
              <Badge variant={stat.v}>{stat.l}</Badge>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// 07 側邊欄 / 導覽
function Sidebar({
  lang,
  collapsed,
  onToggle,
}: {
  lang: Lang;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const t: Tx = STR[lang];
  const [activeNav, setActive] = useState("home");
  const nav: [string, string, string][] = [
    ["home", t.navHome, "home"],
    ["hunt", t.navHunt, "compass"],
    ["dispatch", t.navDispatch, "send"],
    ["team", t.navTeam, "users"],
    ["report", t.navReport, "chart"],
  ];
  const W = collapsed ? 76 : 248;
  return (
    <aside
      style={{
        width: W,
        flexShrink: 0,
        transition: "width .2s",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: collapsed ? "8px 12px" : "8px 6px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: collapsed ? 0 : "0 8px",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "var(--ink)",
            color: "var(--surface-1)",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          T
        </span>
        {!collapsed && (
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--ink)",
                lineHeight: 1.1,
              }}
            >
              {t.brand}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>
              {t.brandSub}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
        }}
      >
        <IconBtn name="menu" label="menu" />
        {!collapsed && (
          <button
            onClick={onToggle}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 999,
              border: "1px solid var(--hairline)",
              background: "var(--surface-1)",
              color: "var(--ink-muted)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 12.5,
            }}
          >
            <Ico d={ICON.chevron} size={14} /> {t.collapse}
          </button>
        )}
        {collapsed && (
          <IconBtn name="layout" label="expand" onClick={onToggle} />
        )}
      </div>

      {!collapsed && (
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--ink-muted)",
              display: "inline-flex",
            }}
          >
            <Ico d={ICON.search} size={15} />
          </span>
          <input
            placeholder={t.search}
            style={{
              width: "100%",
              height: 40,
              paddingLeft: 34,
              paddingRight: 10,
              borderRadius: 999,
              border: "1px solid var(--hairline)",
              background: "var(--surface-1)",
              color: "var(--ink)",
              fontSize: 12.5,
              outline: "none",
            }}
          />
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {nav.map(([id, label, ic]) => {
          const on = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              title={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: 42,
                padding: collapsed ? 0 : "0 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 11,
                border: 0,
                cursor: "pointer",
                fontSize: 13.5,
                fontWeight: on ? 600 : 500,
                background: on ? ACCENT_SOFT : "transparent",
                color: on ? "var(--signal)" : "var(--ink-muted)",
              }}
            >
              <Ico d={ICON[ic]} size={18} />
              {!collapsed && label}
            </button>
          );
        })}
      </nav>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {!collapsed && (
          <div
            style={{ display: "flex", alignItems: "center", paddingLeft: 6 }}
          >
            {MLIST.slice(0, 4).map((m) => (
              <span key={m.id} style={{ marginLeft: -6 }}>
                <Avatar
                  user={{
                    name: nameOf(m, lang),
                    initials: m.initials,
                    color: m.color,
                  }}
                  size="md"
                  ring
                />
              </span>
            ))}
            <span
              style={{
                marginLeft: -6,
                width: 28,
                height: 28,
                borderRadius: 999,
                border: "2px solid var(--surface-1)",
                background: "var(--surface-2)",
                color: "var(--ink-muted)",
                display: "grid",
                placeItems: "center",
                fontSize: 13,
              }}
            >
              +
            </span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: collapsed ? 0 : "10px 10px",
            borderRadius: 14,
            background: collapsed ? "transparent" : "var(--surface-1)",
            border: collapsed ? 0 : "1px solid var(--hairline)",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <Avatar
            user={{
              name: nameOf(MEMBERS.m1, lang),
              initials: MEMBERS.m1.initials,
              color: MEMBERS.m1.color,
            }}
            size="lg"
          />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div
                style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
              >
                {nameOf(MEMBERS.m1, lang)}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                {t.profileRole}
              </div>
            </div>
          )}
        </div>
        {!collapsed ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="sm" className="grow">
              <Ico d={ICON.plus} size={14} /> {t.addWidget}
            </Button>
            <IconBtn name="settings" label={t.settings} />
          </div>
        ) : (
          <IconBtn name="settings" label={t.settings} />
        )}
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------------- showcase wall */
function Cell({
  n,
  name,
  full,
  children,
}: {
  n: string;
  name: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        gridColumn: full ? "1 / -1" : "auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...mono, fontSize: 12, color: "var(--ink-muted)" }}>
          {n}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          {name}
        </span>
      </div>
      {children}
    </div>
  );
}

export function OpsPanelsPage() {
  const { lang } = useApp();
  const t: Tx = STR[lang];
  const [sbCollapsed, setSbCollapsed] = useState(false);

  // 區域根注入面板尺度變數（來源 dashboard.jsx 以 var(--panel-*) 取值；
  // index.css 未定義這些及 --surface-3，故在此供具體 fallback）。
  const wallVars = {
    "--panel-radius": "16px",
    "--panel-shadow": "0 1px 2px rgba(0,0,0,.06)",
    "--panel-pad": "20px",
    "--panel-gap": "16px",
  } as CSSProperties;

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        background: "var(--canvas)",
        color: "var(--ink)",
        fontFamily: "'Noto Sans TC','Inter',system-ui,sans-serif",
        ...wallVars,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "clamp(20px,4vw,40px)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 28,
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: "var(--ink)",
              color: "var(--surface-1)",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            T
          </span>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-.01em",
                color: "var(--ink)",
              }}
            >
              {t.wallTitle}
            </h1>
            <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>
              {t.wallSub}
            </div>
          </div>
          {/* dev-only 設計標註：本頁無 topbar，於此提供開關（與 topbar 同一顆按鈕、同一份 store） */}
          {import.meta.env.DEV && (
            <div
              data-annotate-ui
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                {lang === "zh" ? "標註修改意見" : "Markup feedback"}
              </span>
              <AnnotationToggle />
            </div>
          )}
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))",
            gap: 22,
            alignItems: "start",
          }}
        >
          <Cell n="01" name="TaskPanel" full>
            <TaskPanel lang={lang} />
          </Cell>
          <Cell n="02" name="DispatchPanel" full>
            <DispatchPanel lang={lang} />
          </Cell>
          <Cell n="03" name="ActivityPanel">
            <ActivityPanel lang={lang} />
          </Cell>
          <Cell n="04" name="TenderCardsPanel">
            <TenderCardsPanel lang={lang} />
          </Cell>
          <Cell n="05" name="StatsPanel" full>
            <StatsPanel lang={lang} />
          </Cell>
          <Cell n="06" name="TeamLoadPanel">
            <TeamLoadPanel lang={lang} />
          </Cell>
          <Cell n="07" name="Sidebar">
            <div
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--panel-radius,16px)",
                padding: 8,
                minHeight: 520,
                display: "flex",
              }}
            >
              <Sidebar
                lang={lang}
                collapsed={sbCollapsed}
                onToggle={() => setSbCollapsed((c) => !c)}
              />
            </div>
          </Cell>
        </div>
      </div>
      <AssistantLauncher />
    </div>
  );
}
