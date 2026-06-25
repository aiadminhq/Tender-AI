// /charts：圖表與資料視覺化藝廊（dev-only 內部參考）。
// 以 shadcn/ui chart（recharts v3）示範各型別，全部吃專案 --chart-1..5 token，
// 亮暗雙主題自動適配。資料皆為政府標案情境的擬真示意（非線上真實資料）。
// 本頁為開發期工具，文案直接用繁中、不進產品 i18n 字表（與 design-system 頁一致）。
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────────
// 版面元件：區段標題 + 圖卡（停用 hover 抬升，避免圖表抖動）
// ────────────────────────────────────────────────────────────────────────
function SectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">
        {children}
      </h2>
      {hint && <span className="text-[11px] text-ink-dim">{hint}</span>}
    </div>
  );
}

function ChartCard({
  title,
  desc,
  children,
  className,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "hover:translate-y-0 hover:shadow-[var(--elev-rest)]",
        className,
      )}
    >
      <CardHeader className="flex-col items-start gap-0.5">
        <CardTitle className="text-[13px]">{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 共用：近 14 天日期標籤（示意）
// ────────────────────────────────────────────────────────────────────────
const DAYS = [
  "6/12",
  "6/13",
  "6/14",
  "6/15",
  "6/16",
  "6/17",
  "6/18",
  "6/19",
  "6/20",
  "6/21",
  "6/22",
  "6/23",
  "6/24",
  "6/25",
];

// ── KPI 小卡（demo dashboard-patterns 的 KPI 樣式）──
const KPIS = [
  { label: "今日新進標案", value: "58", delta: "+12%", up: true },
  { label: "本週配對命中率", value: "74%", delta: "+3pt", up: true },
  { label: "團隊收藏總數", value: "1,284", delta: "+45", up: true },
  { label: "可行案件（待處理）", value: "92", delta: "-6", up: false },
];

function KpiRow() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {KPIS.map((k) => (
        <Card
          key={k.label}
          className="hover:translate-y-0 hover:shadow-[var(--elev-rest)]"
        >
          <CardContent className="px-4 py-3.5">
            <p className="text-[11px] text-ink-muted">{k.label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tnum text-[22px] font-semibold leading-none text-ink">
                {k.value}
              </span>
              <span
                className={cn(
                  "tnum text-[11px] font-medium",
                  k.up ? "text-tier-high" : "text-tier-low",
                )}
              >
                {k.delta}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 面積圖 Area
// ════════════════════════════════════════════════════════════════════════

// ① 漸層面積：每日新進標案量（單一序列，唯一允許漸層用途之一）
const dailyIntake = DAYS.map((day, i) => ({
  day,
  count: [44, 58, 61, 17, 9, 52, 67, 63, 71, 22, 11, 49, 64, 58][i],
}));
const dailyIntakeConfig = {
  count: { label: "新進件數", color: "var(--chart-1)" },
} satisfies ChartConfig;

function DailyIntakeArea() {
  return (
    <ChartContainer config={dailyIntakeConfig} className="min-h-[260px] w-full">
      <AreaChart accessibilityLayer data={dailyIntake} margin={{ left: -8 }}>
        <defs>
          <linearGradient id="fillIntake" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-count)"
              stopOpacity={0.8}
            />
            <stop
              offset="95%"
              stopColor="var(--color-count)"
              stopOpacity={0.08}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="count"
          type="natural"
          fill="url(#fillIntake)"
          stroke="var(--color-count)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ② 堆疊面積：三類標案每日配發（工程/財物/勞務）
const dailyByCategory = DAYS.map((day, i) => ({
  day,
  works: [22, 28, 31, 8, 4, 26, 33, 30, 35, 11, 5, 24, 31, 28][i],
  goods: [12, 16, 17, 5, 3, 14, 18, 16, 19, 6, 3, 13, 17, 15][i],
  services: [10, 14, 13, 4, 2, 12, 16, 17, 17, 5, 3, 12, 16, 15][i],
}));
const categorySeriesConfig = {
  works: { label: "工程", color: "var(--chart-1)" },
  goods: { label: "財物", color: "var(--chart-2)" },
  services: { label: "勞務", color: "var(--chart-3)" },
} satisfies ChartConfig;

function DailyStackedArea() {
  return (
    <ChartContainer
      config={categorySeriesConfig}
      className="min-h-[260px] w-full"
    >
      <AreaChart
        accessibilityLayer
        data={dailyByCategory}
        margin={{ left: -8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          dataKey="works"
          type="natural"
          stackId="a"
          fill="var(--color-works)"
          fillOpacity={0.4}
          stroke="var(--color-works)"
        />
        <Area
          dataKey="goods"
          type="natural"
          stackId="a"
          fill="var(--color-goods)"
          fillOpacity={0.4}
          stroke="var(--color-goods)"
        />
        <Area
          dataKey="services"
          type="natural"
          stackId="a"
          fill="var(--color-services)"
          fillOpacity={0.4}
          stroke="var(--color-services)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 長條圖 Bar
// ════════════════════════════════════════════════════════════════════════

// ③ 基本長條：近 6 月每月新進標案數
const monthlyIntake = [
  { month: "1月", count: 820 },
  { month: "2月", count: 910 },
  { month: "3月", count: 1180 },
  { month: "4月", count: 1040 },
  { month: "5月", count: 1260 },
  { month: "6月", count: 1190 },
];
const monthlyConfig = {
  count: { label: "標案數", color: "var(--chart-1)" },
} satisfies ChartConfig;

function MonthlyBar() {
  return (
    <ChartContainer config={monthlyConfig} className="min-h-[260px] w-full">
      <BarChart accessibilityLayer data={monthlyIntake} margin={{ left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

// ④ 橫向長條：各縣市標案數 Top 6（長標籤適合橫向）
const cityIntake = [
  { city: "臺北市", count: 312 },
  { city: "新北市", count: 268 },
  { city: "臺中市", count: 205 },
  { city: "高雄市", count: 187 },
  { city: "桃園市", count: 156 },
  { city: "臺南市", count: 132 },
];
const cityConfig = {
  count: { label: "標案數", color: "var(--chart-1)" },
} satisfies ChartConfig;

function CityHorizontalBar() {
  return (
    <ChartContainer config={cityConfig} className="min-h-[260px] w-full">
      <BarChart
        accessibilityLayer
        data={cityIntake}
        layout="vertical"
        margin={{ left: 8, right: 12 }}
      >
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="city"
          type="category"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
        />
        <XAxis type="number" hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4}>
          <LabelList
            dataKey="count"
            position="right"
            className="fill-foreground"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ⑤ 堆疊長條：各分類 × 潛力分級（色彩對齊 tier 語意：高=綠 中=琥珀 低=紅）
const categoryByTier = [
  { category: "工程", high: 62, mid: 88, low: 41 },
  { category: "財物", high: 38, mid: 71, low: 55 },
  { category: "勞務", high: 49, mid: 64, low: 47 },
];
const tierConfig = {
  high: { label: "高潛力", color: "var(--chart-2)" },
  mid: { label: "中潛力", color: "var(--chart-3)" },
  low: { label: "低潛力", color: "var(--chart-5)" },
} satisfies ChartConfig;

function CategoryTierStackedBar() {
  return (
    <ChartContainer config={tierConfig} className="min-h-[260px] w-full">
      <BarChart accessibilityLayer data={categoryByTier} margin={{ left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="category"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="high"
          stackId="a"
          fill="var(--color-high)"
          radius={[0, 0, 4, 4]}
        />
        <Bar dataKey="mid" stackId="a" fill="var(--color-mid)" />
        <Bar
          dataKey="low"
          stackId="a"
          fill="var(--color-low)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ⑥ 帶標籤長條：預算區間分布（直方圖）
const budgetBuckets = [
  { range: "<100萬", count: 142 },
  { range: "100–500萬", count: 268 },
  { range: "500萬–1千萬", count: 176 },
  { range: "1千–5千萬", count: 98 },
  { range: ">5千萬", count: 37 },
];
const budgetConfig = {
  count: { label: "標案數", color: "var(--chart-4)" },
} satisfies ChartConfig;

function BudgetLabeledBar() {
  return (
    <ChartContainer config={budgetConfig} className="min-h-[260px] w-full">
      <BarChart accessibilityLayer data={budgetBuckets} margin={{ top: 20 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="range"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          fontSize={11}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4}>
          <LabelList
            dataKey="count"
            position="top"
            className="fill-foreground"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 折線圖 Line
// ════════════════════════════════════════════════════════════════════════

// ⑦ 多線：團隊 Layer B 行為趨勢（收藏 / 評分 / 想法，近 7 週）
const behaviorWeekly = [
  { week: "W1", saves: 24, ratings: 12, ideas: 5 },
  { week: "W2", saves: 31, ratings: 18, ideas: 7 },
  { week: "W3", saves: 28, ratings: 16, ideas: 6 },
  { week: "W4", saves: 40, ratings: 22, ideas: 9 },
  { week: "W5", saves: 37, ratings: 25, ideas: 11 },
  { week: "W6", saves: 45, ratings: 29, ideas: 10 },
  { week: "W7", saves: 52, ratings: 34, ideas: 14 },
];
const behaviorConfig = {
  saves: { label: "收藏", color: "var(--chart-1)" },
  ratings: { label: "評分", color: "var(--chart-2)" },
  ideas: { label: "想法", color: "var(--chart-4)" },
} satisfies ChartConfig;

function BehaviorMultiLine() {
  return (
    <ChartContainer config={behaviorConfig} className="min-h-[260px] w-full">
      <LineChart accessibilityLayer data={behaviorWeekly} margin={{ left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="week"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="saves"
          type="monotone"
          stroke="var(--color-saves)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          dataKey="ratings"
          type="monotone"
          stroke="var(--color-ratings)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          dataKey="ideas"
          type="monotone"
          stroke="var(--color-ideas)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

// ⑧ 帶點折線：每週推薦配對命中率（%）
const hitRateWeekly = [
  { week: "W1", rate: 54 },
  { week: "W2", rate: 58 },
  { week: "W3", rate: 57 },
  { week: "W4", rate: 63 },
  { week: "W5", rate: 66 },
  { week: "W6", rate: 71 },
  { week: "W7", rate: 74 },
];
const hitRateConfig = {
  rate: { label: "命中率", color: "var(--chart-1)" },
} satisfies ChartConfig;

function HitRateDottedLine() {
  return (
    <ChartContainer config={hitRateConfig} className="min-h-[260px] w-full">
      <LineChart accessibilityLayer data={hitRateWeekly} margin={{ left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="week"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={32}
          domain={[40, 80]}
          tickFormatter={(v) => `${v}%`}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="rate"
          type="natural"
          stroke="var(--color-rate)"
          strokeWidth={2}
          dot={{ fill: "var(--color-rate)", r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 圓餅 / 雷達 / 放射
// ════════════════════════════════════════════════════════════════════════

// ⑨ 甜甜圈（中心數字）：標案分類佔比
const categoryShare = [
  { name: "works", value: 142, fill: "var(--color-works)" },
  { name: "goods", value: 98, fill: "var(--color-goods)" },
  { name: "services", value: 116, fill: "var(--color-services)" },
  { name: "other", value: 24, fill: "var(--color-other)" },
];
const shareConfig = {
  value: { label: "件數" },
  works: { label: "工程", color: "var(--chart-1)" },
  goods: { label: "財物", color: "var(--chart-2)" },
  services: { label: "勞務", color: "var(--chart-3)" },
  other: { label: "其他", color: "var(--chart-4)" },
} satisfies ChartConfig;
const shareTotal = categoryShare.reduce((a, c) => a + c.value, 0);

function CategoryDonut() {
  return (
    <ChartContainer
      config={shareConfig}
      className="mx-auto aspect-square max-h-[260px]"
    >
      <PieChart>
        <ChartTooltip
          content={<ChartTooltipContent nameKey="name" hideLabel />}
        />
        <Pie
          data={categoryShare}
          dataKey="value"
          nameKey="name"
          innerRadius={56}
          strokeWidth={5}
        >
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-2xl font-bold"
                    >
                      {shareTotal.toLocaleString()}
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy || 0) + 22}
                      className="fill-muted-foreground text-xs"
                    >
                      總件數
                    </tspan>
                  </text>
                );
              }
            }}
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  );
}

// ⑩ 雷達（雙序列＋點）：團隊偏好維度（本季 vs 上季）
const preferenceRadar = [
  { dim: "預算契合", current: 82, previous: 70 },
  { dim: "領域契合", current: 91, previous: 80 },
  { dim: "地區", current: 68, previous: 60 },
  { dim: "時程", current: 74, previous: 66 },
  { dim: "規模", current: 63, previous: 55 },
  { dim: "得標經驗", current: 79, previous: 64 },
];
const preferenceConfig = {
  current: { label: "本季", color: "var(--chart-1)" },
  previous: { label: "上季", color: "var(--chart-4)" },
} satisfies ChartConfig;

function PreferenceRadar() {
  return (
    <ChartContainer
      config={preferenceConfig}
      className="mx-auto aspect-square max-h-[260px]"
    >
      <RadarChart data={preferenceRadar}>
        <ChartTooltip content={<ChartTooltipContent />} />
        <PolarAngleAxis dataKey="dim" />
        <PolarGrid />
        <Radar
          dataKey="current"
          fill="var(--color-current)"
          fillOpacity={0.55}
          stroke="var(--color-current)"
          dot={{ r: 3, fillOpacity: 1 }}
        />
        <Radar
          dataKey="previous"
          fill="var(--color-previous)"
          fillOpacity={0.25}
          stroke="var(--color-previous)"
          dot={{ r: 3, fillOpacity: 1 }}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </RadarChart>
    </ChartContainer>
  );
}

// ⑪ 放射量表（多 bar）：三類本月處理進度（件）
const processProgress = [
  { name: "works", value: 78, fill: "var(--color-works)" },
  { name: "goods", value: 56, fill: "var(--color-goods)" },
  { name: "services", value: 64, fill: "var(--color-services)" },
];
const processConfig = {
  value: { label: "已處理" },
  works: { label: "工程", color: "var(--chart-1)" },
  goods: { label: "財物", color: "var(--chart-2)" },
  services: { label: "勞務", color: "var(--chart-3)" },
} satisfies ChartConfig;

function ProcessRadialGauge() {
  return (
    <ChartContainer
      config={processConfig}
      className="mx-auto aspect-square max-h-[260px]"
    >
      <RadialBarChart data={processProgress} innerRadius={32} outerRadius={108}>
        <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
        <RadialBar dataKey="value" background cornerRadius={6} />
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </RadialBarChart>
    </ChartContainer>
  );
}

// ⑫ 放射量表（中心文字）：整體配對命中率
const overallHit = [{ name: "hit", value: 73, fill: "var(--color-hit)" }];
const overallHitConfig = {
  value: { label: "命中率" },
  hit: { label: "命中率", color: "var(--chart-1)" },
} satisfies ChartConfig;

function OverallHitRadial() {
  return (
    <ChartContainer
      config={overallHitConfig}
      className="mx-auto aspect-square max-h-[260px]"
    >
      <RadialBarChart
        data={overallHit}
        startAngle={90}
        endAngle={90 - (360 * 73) / 100}
        innerRadius={78}
        outerRadius={108}
      >
        <PolarGrid
          gridType="circle"
          radialLines={false}
          stroke="none"
          className="first:fill-muted last:fill-background"
          polarRadius={[84, 72]}
        />
        <RadialBar dataKey="value" background cornerRadius={10} />
        <Label
          content={({ viewBox }) => {
            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
              return (
                <text
                  x={viewBox.cx}
                  y={viewBox.cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  <tspan
                    x={viewBox.cx}
                    y={viewBox.cy}
                    className="fill-foreground text-3xl font-bold"
                  >
                    73%
                  </tspan>
                  <tspan
                    x={viewBox.cx}
                    y={(viewBox.cy || 0) + 22}
                    className="fill-muted-foreground text-xs"
                  >
                    本月命中率
                  </tspan>
                </text>
              );
            }
          }}
        />
      </RadialBarChart>
    </ChartContainer>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 頁面組合
// ════════════════════════════════════════════════════════════════════════
export function ChartsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <PageHeader
        title="圖表藝廊"
        subtitle="shadcn/ui chart × recharts 示範（dev-only）；全部吃 --chart-1..5 token，亮暗雙主題自動適配"
      />

      <KpiRow />

      <section>
        <SectionTitle hint="AreaChart">面積圖 · 趨勢與量體</SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="每日新進標案量"
            desc="近 14 天 · 漸層面積（週末自然回落）"
          >
            <DailyIntakeArea />
          </ChartCard>
          <ChartCard
            title="三類每日配發堆疊"
            desc="工程 / 財物 / 勞務 · 堆疊面積"
          >
            <DailyStackedArea />
          </ChartCard>
        </div>
      </section>

      <section>
        <SectionTitle hint="BarChart">長條圖 · 比較與分布</SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard title="每月新進標案數" desc="近 6 個月 · 基本長條">
            <MonthlyBar />
          </ChartCard>
          <ChartCard title="各縣市標案數 Top 6" desc="橫向長條 · 適合長標籤">
            <CityHorizontalBar />
          </ChartCard>
          <ChartCard
            title="分類 × 潛力分級"
            desc="堆疊長條 · 色彩對齊 tier 語意（高綠／中琥珀／低紅）"
          >
            <CategoryTierStackedBar />
          </ChartCard>
          <ChartCard title="預算區間分布" desc="直方圖 · 頂端數值標籤">
            <BudgetLabeledBar />
          </ChartCard>
        </div>
      </section>

      <section>
        <SectionTitle hint="LineChart">折線圖 · 行為與命中</SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="團隊行為趨勢"
            desc="收藏 / 評分 / 想法 · 近 7 週（Layer B 聚合，示意）"
          >
            <BehaviorMultiLine />
          </ChartCard>
          <ChartCard title="每週推薦命中率" desc="帶點折線 · 百分比軸">
            <HitRateDottedLine />
          </ChartCard>
        </div>
      </section>

      <section>
        <SectionTitle hint="Pie · Radar · Radial">
          圓餅 · 雷達 · 放射
        </SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
          <ChartCard title="標案分類佔比" desc="甜甜圈 · 中心總件數">
            <CategoryDonut />
          </ChartCard>
          <ChartCard title="團隊偏好維度" desc="雷達 · 本季 vs 上季">
            <PreferenceRadar />
          </ChartCard>
          <ChartCard title="三類處理進度" desc="放射量表 · 多序列">
            <ProcessRadialGauge />
          </ChartCard>
          <ChartCard title="整體配對命中率" desc="放射量表 · 中心文字">
            <OverallHitRadial />
          </ChartCard>
        </div>
      </section>
    </div>
  );
}
