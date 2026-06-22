import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import type { TextKey } from "@/i18n/strings";
import type { Category, CriteriaProfile, SourceKey } from "@/types/domain";
import { PageHeader } from "@/components/layout/page-header";
import { MaximizableCard } from "@/components/ui/maximizable-card";
import { Tabs } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TrendChart } from "@/components/dashboard/trend-chart";
import {
  InsightDonut,
  type DonutSegment,
} from "@/components/insights/insight-donut";
import { InsightBars, type BarRow } from "@/components/insights/insight-bars";
import { BudgetCompare } from "@/components/insights/budget-compare";
import {
  aggregateByCategory,
  aggregateBySource,
  budgetBeforeAfter,
} from "@/lib/insights";
import { fetchReasoningProfile } from "@/lib/api";
import { formatBudget } from "@/lib/format";
import { sourceByKey } from "@/data/sources";

// 類別 → 設計 token 色 / 在地化標籤鍵 / 中文詞根（供後端訊號比對）。
const CAT_COLOR: Record<Category, string> = {
  works: "var(--color-signal)",
  goods: "var(--color-priority)",
  services: "var(--color-tier-mid)",
};
const CAT_LABEL: Record<Category, TextKey> = {
  works: "catWorks",
  goods: "catGoods",
  services: "catServices",
};
const CAT_ROOT: Record<Category, string> = {
  works: "工程",
  goods: "財物",
  services: "勞務",
};
// 來源環圈依序套色（最多 4 段，超過則循環）。
const SOURCE_COLORS = [
  "var(--color-signal)",
  "var(--color-tier-high)",
  "var(--color-priority)",
  "var(--color-tier-mid)",
];

export function InsightsPage() {
  const { t, lang } = useApp();
  const { tenders, filteredTenders, filter, setFilter } = useAppData();

  // SL3 判準輪廓（Layer A 唯讀）：連得到後端才標註各類別的「可行傾向」，
  // 連不到一律優雅退化（不顯示學習訊號）。不在前端向量化、不外流。
  const [profile, setProfile] = useState<CriteriaProfile | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchReasoningProfile(ac.signal)
      .then(setProfile)
      .catch(() => setProfile(null));
    return () => ac.abort();
  }, []);

  // 篩選控制目前的單選狀態（多選由其他頁負責；此頁聚焦單維度切換）。
  const selectedCat: Category | "all" =
    filter.categories.length === 1 ? filter.categories[0] : "all";
  const selectedSource: SourceKey | "all" =
    filter.sources.length === 1 ? filter.sources[0] : "all";

  const categoryTabs = useMemo(
    () => [
      { value: "all", label: t("insightsAllCat") },
      { value: "works", label: t("catWorks") },
      { value: "goods", label: t("catGoods") },
      { value: "services", label: t("catServices") },
    ],
    [t],
  );

  // 來源下拉：僅列出實際出現過的來源（依基底全集，不隨篩選消失）。
  const sourceOptions = useMemo(() => {
    const present = Array.from(new Set(tenders.map((x) => x.source)));
    return [
      { value: "all", label: t("allSources") },
      ...present.map((k) => ({ value: k, label: sourceByKey(k).shortName })),
    ];
  }, [tenders, t]);

  // 類別環圈（件數佔比，反映目前工作集）。
  const categorySegments: DonutSegment[] = useMemo(
    () =>
      aggregateByCategory(filteredTenders).map((s) => ({
        key: s.key,
        label: t(CAT_LABEL[s.key]),
        color: CAT_COLOR[s.key],
        count: s.count,
        frac: s.countFrac,
      })),
    [filteredTenders, t],
  );

  // 來源環圈（件數佔比）。
  const sourceSegments: DonutSegment[] = useMemo(
    () =>
      aggregateBySource(filteredTenders).map((s, i) => ({
        key: s.key,
        label: sourceByKey(s.key).shortName,
        color: SOURCE_COLORS[i % SOURCE_COLORS.length],
        count: s.count,
        frac: s.countFrac,
      })),
    [filteredTenders],
  );

  // 各類別預算規模（金額佔比）＋承標判準訊號就地標註。
  const budgetRows: BarRow[] = useMemo(() => {
    const leanNote = (cat: Category): string | undefined => {
      if (!profile) return undefined;
      const sig = profile.categorySignals.find(
        (s) =>
          s.value === cat ||
          s.value === t(CAT_LABEL[cat]) ||
          s.value.includes(CAT_ROOT[cat]),
      );
      if (!sig || sig.support === 0) return undefined;
      const pp = Math.round(sig.lift * 100);
      const signed = pp >= 0 ? `+${pp}` : `${pp}`;
      return `${t("insightsFitLean")} ${signed}% · ${t("insightsSamples")} ${sig.support}`;
    };
    return aggregateByCategory(filteredTenders).map((s) => ({
      key: s.key,
      label: t(CAT_LABEL[s.key]),
      color: CAT_COLOR[s.key],
      frac: s.budgetFrac,
      valueLabel: formatBudget(s.budget, lang),
      pct: Math.round(s.budgetFrac * 100),
      note: leanNote(s.key),
    }));
  }, [filteredTenders, profile, lang, t]);

  const beforeAfter = useMemo(
    () => budgetBeforeAfter(tenders, filteredTenders),
    [tenders, filteredTenders],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navInsights")} subtitle={t("insightsSub")} />

      {/* 互動篩選：類別／來源／焦點，圖表即時連動 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Tabs
          aria-label={t("categoryDist")}
          value={selectedCat}
          onValueChange={(v) =>
            setFilter({ categories: v === "all" ? [] : [v as Category] })
          }
          items={categoryTabs}
        />
        <Select
          aria-label={t("sourceDist")}
          className="min-w-[140px]"
          value={selectedSource}
          onValueChange={(v) =>
            setFilter({ sources: v === "all" ? [] : [v as SourceKey] })
          }
          options={sourceOptions}
        />
        <span className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Switch
            checked={filter.focusOnly}
            onCheckedChange={(v) => setFilter({ focusOnly: v })}
            label={t("focusOnly")}
          />
          {t("focusOnly")}
        </span>
        <p className="ml-auto text-[12px] text-ink-dim">
          {t("insightsFilterHint")}
        </p>
      </div>

      {/* 分佈：類別／來源環圈並列 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MaximizableCard title={t("categoryDist")}>
          <InsightDonut
            segments={categorySegments}
            centerLabel={t("catTotal")}
          />
        </MaximizableCard>
        <MaximizableCard title={t("sourceDist")}>
          {/* 兩環圈切分同一批標案，中心皆為「件數」；維度由卡片標題區分 */}
          <InsightDonut segments={sourceSegments} centerLabel={t("catTotal")} />
        </MaximizableCard>
      </div>

      {/* 預算：各類別規模（含判準訊號）＋篩選前後對比 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <MaximizableCard
          className="lg:col-span-3"
          title={t("budgetByCategory")}
        >
          <InsightBars rows={budgetRows} />
          <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-[11px] text-ink-dim">
            <Sparkles size={12} strokeWidth={1.75} aria-hidden />
            <span>
              {profile ? t("insightsCriteriaHint") : t("insightsNoBackend")}
            </span>
          </div>
        </MaximizableCard>
        <MaximizableCard
          className="lg:col-span-2"
          title={t("budgetCompareTitle")}
        >
          <BudgetCompare data={beforeAfter} />
        </MaximizableCard>
      </div>

      {/* 近 7 日新案趨勢 */}
      <MaximizableCard title={t("trend7d")}>
        <TrendChart />
      </MaximizableCard>
    </div>
  );
}
