// /design-system：設計系統與元件總覽（dev-only 內部參考）。
// 兩段：① 即時 token（getComputedStyle 讀 :root，隨 topbar 主題切換重讀）；
//        ② 元件藝廊，每組以 data-ds 標記，供標註工具點選時辨識元件名。
// 本頁為開發期工具，文案直接用繁中、不進產品 i18n 字表（避免污染）。
import { useEffect, useState } from "react";
import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import { TierBadge } from "@/components/ui/tier-badge";
import { TrendBadge } from "@/components/ui/trend-badge";
import { CategoryBadge, CategoryIcon } from "@/components/ui/category-badge";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import { Avatar } from "@/components/ui/avatar";
import { BarSpark, LineSpark, StreakDots } from "@/components/ui/sparkline";
import { Info, CircleAlert, CircleCheck, LayoutGrid, List } from "lucide-react";

// ── token 清單：name = CSS 變數、label = 顯示名 ──
const COLOR_TOKENS = [
  { name: "--canvas", label: "canvas" },
  { name: "--surface-1", label: "surface-1" },
  { name: "--surface-2", label: "surface-2" },
  { name: "--hairline", label: "hairline" },
  { name: "--ink", label: "ink" },
  { name: "--ink-muted", label: "ink-muted" },
  { name: "--ink-dim", label: "ink-dim" },
  { name: "--signal", label: "signal" },
  { name: "--primary", label: "primary" },
  { name: "--tier-high", label: "tier-high" },
  { name: "--tier-mid", label: "tier-mid" },
  { name: "--tier-low", label: "tier-low" },
  { name: "--priority", label: "priority" },
  { name: "--success", label: "success" },
  { name: "--danger", label: "danger" },
];

const RADIUS_TOKENS = [
  "--radius",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
];
const SHADOW_TOKENS = ["--elev-rest", "--elev-hover", "--elev-overlay"];
const FONT_TOKENS = ["--font-sans", "--font-num"];

function readVars(names: string[]): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const n of names) out[n] = cs.getPropertyValue(n).trim();
  return out;
}

/** 區段容器：標題 + 說明 + 內容；本身即一張 Bento 卡。 */
function DSSection({
  id,
  title,
  desc,
  children,
}: {
  id: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      data-ds={`section:${id}`}
      className="hover:translate-y-0 hover:shadow-[var(--elev-rest)]"
    >
      <CardHeader className="flex-col items-start gap-0.5">
        <CardTitle className="text-[14px]">{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/** 元件展示列：左側標籤、右側活的元件。 */
function DSRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="w-28 shrink-0 text-[12px] text-ink-dim">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function DesignSystemPage() {
  const { t, lang, theme } = useApp();
  const [colors, setColors] = useState<Record<string, string>>({});
  const [radii, setRadii] = useState<Record<string, string>>({});
  const [shadows, setShadows] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<Record<string, string>>({});
  const [sw, setSw] = useState(true);
  const [tab, setTab] = useState("grid");

  // 主題／語言切換 → 重讀 token（CSS 變數在執行期被覆寫）。
  useEffect(() => {
    setColors(readVars(COLOR_TOKENS.map((c) => c.name)));
    setRadii(readVars(RADIUS_TOKENS));
    setShadows(readVars(SHADOW_TOKENS));
    setFonts(readVars(FONT_TOKENS));
  }, [theme, lang]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title="設計系統"
        subtitle={`元件與 token 總覽（開發期工具）· 目前主題：${theme === "dark" ? "暗色" : "淺色"}`}
      />

      {/* ── 色彩 token ── */}
      <DSSection
        id="color-tokens"
        title="色彩 token"
        desc="即時讀自 :root；切換 topbar 主題會即時更新。"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {COLOR_TOKENS.map((c) => (
            <div
              key={c.name}
              data-ds={`token:${c.label}`}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-1 p-2"
            >
              <span
                className="size-7 shrink-0 rounded-md border border-hairline"
                style={{ background: `var(${c.name})` }}
              />
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-ink">
                  {c.label}
                </p>
                <p className="truncate font-num text-[10px] text-ink-dim">
                  {colors[c.name] || "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </DSSection>

      {/* ── 圓角 / 陰影 / 字體 ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <DSSection id="radius-tokens" title="圓角">
          <div className="space-y-2">
            {RADIUS_TOKENS.map((r) => (
              <div
                key={r}
                data-ds={`token:${r}`}
                className="flex items-center gap-3"
              >
                <span
                  className="size-9 shrink-0 border border-signal/40 bg-signal/10"
                  style={{ borderRadius: `var(${r})` }}
                />
                <div className="min-w-0">
                  <p className="font-num text-[12px] text-ink">{r}</p>
                  <p className="font-num text-[10px] text-ink-dim">
                    {radii[r] || "—"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DSSection>

        <DSSection id="shadow-tokens" title="陰影分層">
          <div className="space-y-3">
            {SHADOW_TOKENS.map((s) => (
              <div
                key={s}
                data-ds={`token:${s}`}
                className="flex items-center gap-3"
              >
                <span
                  className="size-9 shrink-0 rounded-md bg-card"
                  style={{ boxShadow: `var(${s})` }}
                />
                <div className="min-w-0">
                  <p className="font-num text-[12px] text-ink">{s}</p>
                  <p className="truncate font-num text-[10px] text-ink-dim">
                    {shadows[s] || "—"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DSSection>

        <DSSection id="font-tokens" title="字體">
          <div className="space-y-3">
            <div data-ds="token:--font-sans">
              <p className="text-[11px] text-ink-dim">--font-sans</p>
              <p
                className="text-[15px] text-ink"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                惠強設計 Tender AI · The quick brown fox
              </p>
              <p className="truncate font-num text-[10px] text-ink-dim">
                {fonts["--font-sans"]}
              </p>
            </div>
            <Separator />
            <div data-ds="token:--font-num">
              <p className="text-[11px] text-ink-dim">--font-num</p>
              <p className="font-num text-[15px] text-ink">
                1234567890 · NT$ 8,420,000
              </p>
              <p className="truncate font-num text-[10px] text-ink-dim">
                {fonts["--font-num"]}
              </p>
            </div>
          </div>
        </DSSection>
      </div>

      {/* ── 元件藝廊 ── */}
      <DSSection
        id="components"
        title="元件藝廊"
        desc="開啟上方箭頭標註工具，可直接點任一元件提出修改建議。"
      >
        {/* Button */}
        <div data-ds="Button" className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-muted">Button</p>
          <DSRow label="variant">
            <Button variant="primary">primary</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="outline">outline</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="destructive">destructive</Button>
          </DSRow>
          <DSRow label="size">
            <Button size="sm">sm</Button>
            <Button size="md">md</Button>
            <Button size="lg">lg</Button>
            <Button size="icon" aria-label="grid">
              <LayoutGrid size={16} />
            </Button>
          </DSRow>
          <DSRow label="disabled">
            <Button disabled>disabled</Button>
            <Button variant="outline" disabled>
              disabled
            </Button>
          </DSRow>
        </div>

        <Separator />

        {/* Badge 群 */}
        <div data-ds="Badge" className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-muted">Badge</p>
          <DSRow label="variant">
            <Badge variant="default">default</Badge>
            <Badge variant="outline">outline</Badge>
            <Badge variant="signal">signal</Badge>
            <Badge variant="success">success</Badge>
            <Badge variant="danger">danger</Badge>
            <Badge variant="muted">muted</Badge>
          </DSRow>
          <DSRow label="TierBadge">
            <TierBadge tier="high" lang={lang} />
            <TierBadge tier="mid" lang={lang} />
            <TierBadge tier="low" lang={lang} />
          </DSRow>
          <DSRow label="TrendBadge">
            <TrendBadge delta={12} />
            <TrendBadge delta={-8} />
          </DSRow>
          <DSRow label="Category">
            <CategoryIcon category="works" />
            <CategoryIcon category="goods" />
            <CategoryIcon category="services" />
            <CategoryBadge category="works" t={t} />
            <CategoryBadge category="goods" t={t} />
            <CategoryBadge category="services" t={t} />
          </DSRow>
        </div>

        <Separator />

        {/* Alert */}
        <div data-ds="Alert" className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-muted">Alert</p>
          <div className="space-y-2">
            <Alert variant="info" icon={<Info size={16} />}>
              這是一則資訊提示（info）。
            </Alert>
            <Alert variant="success" icon={<CircleCheck size={16} />}>
              已成功儲存設定（success）。
            </Alert>
            <Alert variant="danger" icon={<CircleAlert size={16} />}>
              連線失敗，請稍後重試（danger）。
            </Alert>
          </div>
        </div>

        <Separator />

        {/* 表單元件 */}
        <div data-ds="Form" className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-muted">表單</p>
          <DSRow label="Input">
            <Input placeholder="輸入關鍵字…" className="w-56" />
          </DSRow>
          <DSRow label="Switch">
            <Switch checked={sw} onCheckedChange={setSw} label="示範開關" />
            <span className="text-[12px] text-ink-muted">
              {sw ? "開啟" : "關閉"}
            </span>
          </DSRow>
          <DSRow label="Tabs">
            <Tabs
              value={tab}
              onValueChange={setTab}
              aria-label="檢視切換"
              items={[
                {
                  value: "grid",
                  label: "卡片",
                  icon: <LayoutGrid size={14} />,
                },
                { value: "list", label: "清單", icon: <List size={14} /> },
              ]}
            />
          </DSRow>
        </div>

        <Separator />

        {/* 資料視覺 */}
        <div data-ds="DataViz" className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-muted">資料視覺</p>
          <DSRow label="FeasibilityMeter">
            <div className="w-44">
              <FeasibilityMeter value={72} showLabel />
            </div>
          </DSRow>
          <DSRow label="Sparkline">
            <div className="h-9 w-24">
              <BarSpark data={[3, 5, 4, 6, 8, 7, 9]} />
            </div>
            <div className="h-9 w-24">
              <LineSpark data={[3, 5, 4, 6, 8, 7, 9]} />
            </div>
            <div className="h-9">
              <StreakDots active={3} />
            </div>
          </DSRow>
          <DSRow label="Avatar">
            <Avatar
              user={{
                initials: "AC",
                color: "var(--signal)",
                name: "Aaron Chang",
              }}
              size="sm"
            />
            <Avatar
              user={{
                initials: "HQ",
                color: "var(--priority)",
                name: "HQ Admin",
              }}
              size="md"
            />
            <Avatar
              user={{
                initials: "TA",
                color: "var(--tier-mid)",
                name: "Tender AI",
              }}
              size="lg"
              ring
            />
          </DSRow>
        </div>

        <Separator />

        {/* Card */}
        <div data-ds="Card" className="space-y-2">
          <p className="text-[12px] font-semibold text-ink-muted">Card</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>標案卡片</CardTitle>
                <TierBadge tier="high" lang={lang} />
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Bento 分區卡：靜置 elev-rest、hover 抬升 elev-hover。
                </CardDescription>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>含可行性</CardTitle>
                <Badge variant="signal">示範</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                <CardDescription>卡片內可組合任意元件。</CardDescription>
                <FeasibilityMeter value={58} showLabel />
              </CardContent>
            </Card>
          </div>
        </div>
      </DSSection>
    </div>
  );
}
