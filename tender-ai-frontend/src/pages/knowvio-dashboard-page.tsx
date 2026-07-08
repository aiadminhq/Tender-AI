import { useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Brain,
  ChevronRight,
  Clock,
  Flame,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { daysLeft } from "@/lib/format";
import {
  type DonutBucketKey,
  donutSegmentsFromActivity,
  type KnowvioStatusKind,
  statusByTenderId,
  tenderStatusKind,
  trendDeltaPct,
} from "@/lib/knowvio-aggregations";
import type { ActivityItem } from "@/types/domain";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";

/* =========================================================================
   Knowvio 風格儀表板（忠實複刻：淺色奶油底＋橘調＋柔影）
   —— 自包含頁面。為避免汙染全域深色 token，整頁以區域 class `kv` 設定
   自有的淺色調色盤；不改 index.css、不影響其他頁。內容換成本專案標案資料。
   獨立路由 /knowvio，不套 AppShell。
   ========================================================================= */

// 本頁區域字典（zh/en 成對；house rule）。
const TX = {
  zh: {
    welcome: "歡迎回來，Alex！",
    welcomeSub: "今天有 {n} 件高潛力新案，別錯過 →",
    searchPh: "搜尋標案、機關、關鍵字…",
    highlights: "重點摘要",
    refresh: "重新整理",
    kpiNew: "今日新案",
    kpiHigh: "高潛力",
    kpiScore: "平均分數",
    kpiStreak: "連續承接",
    days: "天",
    progress: "案量趨勢",
    progressSub: "近 7 日新案趨勢",
    activity: "本週活動分佈",
    totalHrs: "總動作",
    actView: "瀏覽標案",
    actRate: "評分標記",
    actBoard: "加入看板",
    actExport: "匯出／動作",
    actEmpty: "尚無活動紀錄",
    deadlines: "即將截止",
    colTask: "標案／任務",
    colDue: "截止日",
    colType: "類型",
    colStatus: "狀態",
    colPriority: "優先",
    sort: "排序",
    filter: "篩選",
    stPending: "待處理",
    stNotStarted: "未開始",
    stInProgress: "進行中",
    prHigh: "高",
    prMid: "中",
    quick: "快速複盤",
    quickSub: "2 分鐘溫習你的篩選標準！",
    quickPh: "選一個主題來複盤…",
    recent: "最近：營繕工程資格判讀",
    practice: "練習",
    startQuiz: "開始評分",
    live: "即時資料",
    demo: "示範資料",
  },
  en: {
    welcome: "Welcome Back Alex!",
    welcomeSub: "{n} high-potential tenders today — don't miss them →",
    searchPh: "Search tenders, agencies, keywords…",
    highlights: "Highlights",
    refresh: "Refresh Data",
    kpiNew: "New Today",
    kpiHigh: "High Potential",
    kpiScore: "Average Score",
    kpiStreak: "Win Streak",
    days: "Days",
    progress: "Volume Trend",
    progressSub: "Last 7 days · new tenders",
    activity: "Weekly Activity Split",
    totalHrs: "Actions",
    actView: "Tenders Viewed",
    actRate: "Rated / Tagged",
    actBoard: "Added to Board",
    actExport: "Export / Action",
    actEmpty: "No activity yet",
    deadlines: "Upcoming Deadlines",
    colTask: "Tender / Task",
    colDue: "Due Date",
    colType: "Type",
    colStatus: "Status",
    colPriority: "Priority",
    sort: "Sort",
    filter: "Filter",
    stPending: "Pending",
    stNotStarted: "Not Started",
    stInProgress: "In Progress",
    prHigh: "High",
    prMid: "Medium",
    quick: "Quick Review",
    quickSub: "Sharpen your criteria in 2 minutes!",
    quickPh: "Choose a topic to review…",
    recent: "Recent: Renovation eligibility",
    practice: "Practice",
    startQuiz: "Start Review",
    live: "Live",
    demo: "Demo",
  },
} as const;

const CAT_LABEL = {
  zh: { works: "營繕工程", goods: "財物", services: "勞務" },
  en: { works: "Works", goods: "Goods", services: "Services" },
} as const;

// tx/cat 來自 TX[lang]／CAT_LABEL[lang]，型別為 zh|en literal 聯集；元件 prop 以
// 「值為 string」的結構型別承接，避免 literal 聯集不可賦值給單一語系 literal。
type Tx = { [K in keyof (typeof TX)["zh"]]: string };
type Cat = { [K in keyof (typeof CAT_LABEL)["zh"]]: string };

export function KnowvioDashboardPage() {
  const { lang } = useApp();
  const { metrics, filteredTenders, usingLiveData, activity, cards, trend7d } =
    useAppData();
  const tx = TX[lang === "en" ? "en" : "zh"];
  const cat = CAT_LABEL[lang === "en" ? "en" : "zh"];

  const statusMap = useMemo(() => statusByTenderId(cards), [cards]);
  const newDelta = useMemo(() => trendDeltaPct(trend7d), [trend7d]);

  const upcoming = useMemo(
    () =>
      filteredTenders
        .filter((x) => x.deadline && daysLeft(x.deadline) >= 0)
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .slice(0, 5),
    [filteredTenders],
  );

  const avgScore = useMemo(() => {
    if (!filteredTenders.length) return 0;
    const s = filteredTenders.reduce((a, x) => a + (x.score || 0), 0);
    return Math.round(s / filteredTenders.length);
  }, [filteredTenders]);

  return (
    <div className="kv min-h-dvh w-full bg-[#e8eaed] p-3 text-[#111827] antialiased sm:p-5 lg:p-6">
      <div className="mx-auto flex max-w-[1240px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(16,24,40,.25)] sm:rounded-[28px]">
        <KvSidebar />

        {/* 主內容 */}
        <main className="min-w-0 flex-1 bg-[#fafbfc] p-4 sm:p-6 lg:p-7">
          <TopWelcome tx={tx} highCount={metrics.kpiHigh} />

          {/* Highlights 標頭 */}
          <div className="mb-3 mt-7 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {tx.highlights}
            </h2>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e9ee] bg-white px-3 py-1.5 text-[12px] font-medium text-[#6b7280] transition hover:text-[#111827]">
              <span className="i">↻</span>
              {tx.refresh}
            </button>
          </div>

          {/* KPI 列：每張內嵌迷你圖＋變化徽章 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={Inbox}
              label={tx.kpiNew}
              value={String(metrics.kpiNew)}
              delta={newDelta}
              chart={<BarSpark />}
            />
            <KpiCard
              icon={Flame}
              label={tx.kpiHigh}
              value={String(metrics.kpiHigh)}
              delta={null}
              chart={<LineSpark />}
            />
            <KpiCard
              icon={Target}
              label={tx.kpiScore}
              value={`${avgScore}`}
              suffix="%"
              delta={null}
              chart={<LineSpark muted />}
            />
            <KpiCard
              icon={Flame}
              label={tx.kpiStreak}
              value={String(metrics.kpiAccepted)}
              suffix={` ${tx.days}`}
              delta={null}
              chart={<StreakDots active={metrics.kpiAccepted} />}
            />
          </div>

          {/* 第一排雙欄：趨勢面積圖（含 hover tooltip）＋活動甜甜圈 */}
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHead title={tx.progress} sub={tx.progressSub}>
                <div className="flex gap-2">
                  <Pill>{lang === "en" ? "All works" : "全部工程"}</Pill>
                  <Pill>{lang === "en" ? "October" : "六月"}</Pill>
                </div>
              </CardHead>
              <ProgressArea lang={lang} series={trend7d} />
            </Card>

            <Card>
              <CardHead title={tx.activity}>
                <button className="grid h-7 w-7 place-items-center rounded-lg border border-[#e7e9ee] text-[#9ca3af]">
                  <ChevronRight size={15} />
                </button>
              </CardHead>
              <ActivityDonut tx={tx} activity={activity} />
            </Card>
          </div>

          {/* 第二排雙欄：截止表格（彩色徽章）＋快速複盤 */}
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHead title={tx.deadlines}>
                <div className="flex gap-2">
                  <Pill>{tx.sort}</Pill>
                  <Pill>{tx.filter}</Pill>
                </div>
              </CardHead>
              <DeadlineTable
                tx={tx}
                cat={cat}
                rows={upcoming}
                live={usingLiveData}
                statusMap={statusMap}
              />
            </Card>

            <Card>
              <CardHead title={tx.quick} sub={tx.quickSub} />
              <QuickReview tx={tx} />
            </Card>
          </div>
        </main>
      </div>

      {/* 專案既有 AI 小助手（自包含浮動面板，含 runtime/引導/匯流排） */}
      <AssistantLauncher />
    </div>
  );
}

/* ----------------------------- 共用卡片殼 ----------------------------- */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#eceef2] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.05),0_4px_12px_-6px_rgba(16,24,40,.08)]">
      {children}
    </section>
  );
}

function CardHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[14px] font-semibold tracking-tight text-[#111827]">
          {title}
        </h3>
        {sub && <p className="mt-0.5 text-[12px] text-[#9ca3af]">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-1 rounded-lg border border-[#e7e9ee] bg-white px-2.5 py-1 text-[12px] font-medium text-[#6b7280] transition hover:text-[#111827]">
      {children}
    </button>
  );
}

/* ----------------------------- 側邊欄 ----------------------------- */
const NAV: {
  icon: LucideIcon;
  label: { zh: string; en: string };
  active?: boolean;
}[] = [
  {
    icon: LayoutDashboard,
    label: { zh: "戰情總覽", en: "Dashboard" },
    active: true,
  },
  { icon: ListChecks, label: { zh: "標案清單", en: "Tenders" } },
  { icon: KanbanSquare, label: { zh: "看板", en: "Board" } },
  { icon: Sparkles, label: { zh: "小助手", en: "Assistant" } },
  { icon: Search, label: { zh: "搜尋", en: "Search" } },
  { icon: Bell, label: { zh: "推播", en: "Notifications" } },
  { icon: Brain, label: { zh: "自演化", en: "Evolution" } },
  { icon: SlidersHorizontal, label: { zh: "規則", en: "Rules" } },
];

function KvSidebar() {
  const { lang } = useApp();
  const L = lang === "en" ? "en" : "zh";
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col border-r border-[#eef0f3] bg-white p-4 lg:flex">
      {/* logo */}
      <div className="mb-5 flex items-center gap-2.5 px-1.5 pt-1">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#fb923c] to-[#f97316] text-white">
          <Sparkles size={16} />
        </span>
        <span className="text-[15px] font-bold tracking-tight">投標作戰台</span>
      </div>

      <nav className="space-y-0.5">
        {NAV.map((n) => (
          <a
            key={n.label.en}
            className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition ${
              n.active
                ? "bg-[#fff4ec] text-[#ea580c]"
                : "text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]"
            }`}
          >
            <n.icon size={17} strokeWidth={2} />
            {n.label[L]}
            {n.label.en === "Notifications" && (
              <span className="ml-auto rounded-full bg-[#f97316] px-1.5 py-px text-[10px] font-semibold text-white">
                9+
              </span>
            )}
          </a>
        ))}
      </nav>

      {/* 使用者 */}
      <div className="mt-auto flex items-center gap-2.5 rounded-xl border border-[#eef0f3] p-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#fdba74] to-[#fb923c] text-[12px] font-bold text-white">
          A
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">Alex Johnson</div>
          <div className="truncate text-[11px] text-[#9ca3af]">
            alex@hqdesign.tw
          </div>
        </div>
        <MoreHorizontal size={16} className="ml-auto text-[#9ca3af]" />
      </div>
    </aside>
  );
}

/* ----------------------------- 頂部歡迎列 ----------------------------- */
function TopWelcome({ tx, highCount }: { tx: Tx; highCount: number }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold tracking-tight sm:text-[22px]">
          {tx.welcome}
        </h1>
        <p className="mt-1 text-[13px] text-[#6b7280]">
          {tx.welcomeSub.replace("{n}", String(highCount))}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e7e9ee] bg-white px-3 py-2 lg:flex-none">
          <Search size={15} className="shrink-0 text-[#9ca3af]" />
          <input
            placeholder={tx.searchPh}
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#9ca3af] lg:w-[200px] lg:flex-none"
          />
        </div>
        <IconBtn badge="9">
          <MessageSquare size={17} />
        </IconBtn>
        <IconBtn>
          <Bell size={17} />
        </IconBtn>
        <IconBtn>
          <MoreHorizontal size={17} />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  badge,
}: {
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <button className="relative grid h-9 w-9 place-items-center rounded-full border border-[#e7e9ee] bg-white text-[#6b7280] transition hover:text-[#111827]">
      {children}
      {badge && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#f97316] px-1 text-[9px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ----------------------------- KPI 卡 ----------------------------- */
function KpiCard({
  icon: Icon,
  label,
  value,
  suffix,
  delta,
  chart,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  suffix?: string;
  delta?: string | null;
  chart: React.ReactNode;
}) {
  const deltaDown = !!delta && delta.startsWith("-");
  return (
    <div className="rounded-2xl border border-[#eceef2] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.05)]">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#fff4ec] text-[#f97316]">
          <Icon size={16} strokeWidth={2} />
        </span>
        <span className="truncate text-[12px] font-medium text-[#6b7280]">
          {label}
        </span>
        {delta ? (
          <span
            className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              deltaDown
                ? "bg-[#fee2e2] text-[#dc2626]"
                : "bg-[#dcfce7] text-[#16a34a]"
            }`}
          >
            {delta}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="font-mono text-[28px] font-bold leading-none tracking-tight">
          {value}
          {suffix && (
            <span className="ml-0.5 text-[14px] font-semibold text-[#9ca3af]">
              {suffix}
            </span>
          )}
        </div>
        <div className="h-9 w-[88px] shrink-0">{chart}</div>
      </div>
    </div>
  );
}

function BarSpark() {
  const bars = [10, 16, 12, 22, 18, 28, 24, 34];
  const max = Math.max(...bars);
  return (
    <svg
      viewBox="0 0 88 36"
      className="h-full w-full"
      preserveAspectRatio="none"
    >
      {bars.map((b, i) => {
        const h = (b / max) * 32;
        return (
          <rect
            key={i}
            x={i * 11 + 1}
            y={36 - h}
            width={7}
            height={h}
            rx={2}
            fill={i === bars.length - 1 ? "#f97316" : "#fdba74"}
          />
        );
      })}
    </svg>
  );
}

function LineSpark({ muted }: { muted?: boolean }) {
  const pts = [22, 20, 24, 18, 23, 14, 18, 9];
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const d = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * 86 + 1;
      const y = 33 - ((p - min) / (max - min || 1)) * 28;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const color = muted ? "#fb923c" : "#f97316";
  return (
    <svg
      viewBox="0 0 88 36"
      className="h-full w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={muted ? "ls2" : "ls1"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L87 36 L1 36 Z`} fill={`url(#${muted ? "ls2" : "ls1"})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function StreakDots({ active }: { active: number }) {
  const total = 4;
  const on = Math.min(Math.max(active, 0), total);
  return (
    <div className="flex h-full items-center justify-end gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`grid h-6 w-6 place-items-center rounded-full ${
            i < on
              ? "bg-[#fff4ec] text-[#f97316]"
              : "bg-[#f3f4f6] text-[#d1d5db]"
          }`}
        >
          <Flame size={12} />
        </span>
      ))}
    </div>
  );
}

/* ----------------------------- 趨勢面積圖（hover tooltip） ----------------------------- */
function ProgressArea({ lang, series }: { lang: string; series: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const W = 100;
  const H = 100;
  const TOP = 12;
  const BOT = 8;
  const n = series.length;

  // 近 N 日標籤：最後一點＝今日，往前推「−k 日」。
  const dayLabel = (i: number) => {
    const back = n - 1 - i;
    if (back === 0) return lang === "en" ? "Today" : "今日";
    return lang === "en" ? `−${back}d` : `−${back}日`;
  };

  // 空態：無趨勢資料時優雅降級（沿用示範/無資料語氣）。
  if (n === 0) {
    return (
      <div className="flex h-52 items-center justify-center text-[12px] text-[#9ca3af]">
        {lang === "en" ? "No trend data yet" : "尚無趨勢資料"}
      </div>
    );
  }

  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => ({
    x: n > 1 ? (i / (n - 1)) * W : W / 2,
    y: TOP + (1 - v / max) * (H - TOP - BOT),
    v,
  }));
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
    .join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.round(Math.min(Math.max(ratio, 0), 1) * (n - 1)));
  };

  const hp = hover != null ? pts[hover] : null;
  // 逐點 delta：該點對前一點的百分比變化；首點或前值 0 時為 null（不灌假數）。
  const hoverDelta =
    hover != null ? trendDeltaPct(series.slice(hover - 1, hover + 1)) : null;

  return (
    <div
      ref={wrapRef}
      className="relative h-52 select-none"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* Y 軸刻度 */}
      <div className="absolute inset-y-0 left-0 flex w-7 flex-col justify-between py-1 text-[10px] text-[#c2c7d0]">
        {[100, 75, 50, 25, 0].map((v) => (
          <span key={v} className="font-mono">
            {v}
          </span>
        ))}
      </div>

      <div className="absolute inset-y-0 left-8 right-0">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id="kvArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {/* 水平格線 */}
          {[0, 25, 50, 75].map((g) => {
            const y = TOP + (g / 100) * (H - TOP - BOT);
            return (
              <line
                key={g}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke="#eef0f3"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <path d={area} fill="url(#kvArea)" />
          <path
            d={line}
            fill="none"
            stroke="#f97316"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {hp && (
            <line
              x1={hp.x}
              x2={hp.x}
              y1={hp.y}
              y2={H}
              stroke="#f97316"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* hover 點 */}
        {hp && (
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f97316] ring-[3px] ring-white"
            style={{ left: `${hp.x}%`, top: `${hp.y}%` }}
          />
        )}

        {/* tooltip */}
        {hp && hover != null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-xl border border-[#eceef2] bg-white px-3 py-2 shadow-[0_8px_24px_-6px_rgba(16,24,40,.2)]"
            style={{
              left: `${Math.min(Math.max(hp.x, 12), 88)}%`,
              top: `${hp.y}%`,
            }}
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#111827]">
              {dayLabel(hover)}
              {hoverDelta ? (
                <span
                  className={`rounded px-1 text-[10px] ${
                    hoverDelta.startsWith("-")
                      ? "bg-[#fee2e2] text-[#dc2626]"
                      : "bg-[#dcfce7] text-[#16a34a]"
                  }`}
                >
                  {hoverDelta}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-[13px] font-bold text-[#f97316]">
                {hp.v}
              </span>
              <span className="h-1 w-12 overflow-hidden rounded-full bg-[#f3f4f6]">
                <span
                  className="block h-full rounded-full bg-[#f97316]"
                  style={{ width: `${(hp.v / max) * 100}%` }}
                />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* X 軸：近 N 日 */}
      <div className="absolute bottom-0 left-8 right-0 flex justify-between text-[10px] text-[#c2c7d0]">
        {series.map((_, i) => (
          <span key={i} className="font-mono">
            {dayLabel(i)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- 活動甜甜圈 ----------------------------- */
const DONUT_COLOR: Record<DonutBucketKey, string> = {
  view: "#fb923c",
  rate: "#3b82f6",
  board: "#ec4899",
  other: "#22c55e",
};

function ActivityDonut({ tx, activity }: { tx: Tx; activity: ActivityItem[] }) {
  const donutLabel: Record<DonutBucketKey, string> = {
    view: tx.actView,
    rate: tx.actRate,
    board: tx.actBoard,
    other: tx.actExport,
  };
  const total = activity.length;
  const segs = donutSegmentsFromActivity(activity).map((s) => ({
    label: donutLabel[s.key],
    pct: s.pct,
    color: DONUT_COLOR[s.key],
  }));

  // 空態：尚無活動事件時優雅降級。
  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[12px] text-[#9ca3af]">
        <span>{tx.actEmpty}</span>
      </div>
    );
  }

  const R = 42;
  const C = 2 * Math.PI * R;
  const GAP = 3;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="#f3f4f6"
            strokeWidth={14}
          />
          {segs.map((s) => {
            const len = (s.pct / 100) * C;
            const start = acc;
            acc += len;
            return (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={14}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(len - GAP, 1)} ${C}`}
                strokeDashoffset={-start}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-[#9ca3af]">
            {tx.totalHrs}
          </span>
          <span className="font-mono text-[30px] font-bold leading-none">
            {total}
          </span>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-2.5">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            <span className="truncate text-[#6b7280]">{s.label}</span>
            <span className="ml-auto font-mono font-semibold text-[#111827]">
              {s.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- 截止表格（彩色徽章） ----------------------------- */
type StatusKind = "pending" | "notStarted" | "inProgress";
const STATUS_STYLE: Record<StatusKind, string> = {
  pending: "text-[#ea580c]",
  notStarted: "bg-[#eff6ff] text-[#2563eb]",
  inProgress: "text-[#16a34a]",
};

function DeadlineTable({
  tx,
  cat,
  rows,
  live,
  statusMap,
}: {
  tx: Tx;
  cat: Cat;
  rows: ReturnType<typeof useAppData>["filteredTenders"];
  live: boolean;
  statusMap: Map<string, KnowvioStatusKind>;
}) {
  const dotByTier = {
    high: "#ec4899",
    mid: "#3b82f6",
    low: "#22c55e",
  } as const;
  const statusLabel = {
    pending: tx.stPending,
    notStarted: tx.stNotStarted,
    inProgress: tx.stInProgress,
  };

  if (!rows.length) {
    return (
      <div className="py-10 text-center text-[13px] text-[#9ca3af]">
        {live ? "目前無即將截止的標案" : "示範資料載入中…"}
      </div>
    );
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[460px] border-collapse text-left">
        <thead>
          <tr className="text-[11px] font-medium text-[#9ca3af]">
            <th className="pb-2.5 font-medium">{tx.colTask}</th>
            <th className="pb-2.5 font-medium">{tx.colDue}</th>
            <th className="pb-2.5 font-medium">{tx.colType}</th>
            <th className="pb-2.5 font-medium">{tx.colStatus}</th>
            <th className="pb-2.5 text-right font-medium">{tx.colPriority}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sk = tenderStatusKind(statusMap, r.id);
            return (
              <tr
                key={r.id}
                className="border-t border-[#f1f2f5] text-[12.5px]"
              >
                <td className="py-3 pr-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: dotByTier[r.tier] }}
                    />
                    <span className="truncate font-medium text-[#111827]">
                      {r.title}
                    </span>
                  </span>
                </td>
                <td className="py-3 pr-3 font-mono text-[#6b7280]">
                  {r.deadline}
                </td>
                <td className="py-3 pr-3 text-[#6b7280]">{cat[r.category]}</td>
                <td className="py-3 pr-3">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[sk]}`}
                  >
                    {statusLabel[sk]}
                  </span>
                </td>
                <td className="py-3 text-right text-[12px] font-medium text-[#374151]">
                  {r.tier === "high" ? tx.prHigh : tx.prMid}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- 快速複盤卡 ----------------------------- */
function QuickReview({ tx }: { tx: Tx }) {
  const icons = [Sparkles, Activity, Star, Clock, Brain];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] px-3 py-2.5">
        <Search size={15} className="text-[#9ca3af]" />
        <span className="text-[12px] text-[#9ca3af]">{tx.quickPh}</span>
      </div>
      <p className="text-[11px] text-[#9ca3af]">{tx.recent}</p>
      <div className="flex items-center gap-2">
        {icons.map((Ic, i) => (
          <span
            key={i}
            className="grid h-9 w-9 place-items-center rounded-xl border border-[#eceef2] bg-white text-[#6b7280]"
          >
            <Ic size={15} />
          </span>
        ))}
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#eceef2] text-[#9ca3af]">
          <ChevronRight size={15} />
        </span>
      </div>
      <div className="mt-1 flex gap-2.5">
        <button className="flex-1 rounded-xl border border-[#e7e9ee] bg-white py-2.5 text-[12px] font-semibold text-[#374151] transition hover:bg-[#f9fafb]">
          {tx.practice}
        </button>
        <button className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#111827] py-2.5 text-[12px] font-semibold text-white transition hover:bg-black">
          {tx.startQuiz}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
