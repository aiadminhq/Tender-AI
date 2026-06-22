import { useApp } from "@/store/app-context";
import { formatBudget, formatInt } from "@/lib/format";
import type { BeforeAfter } from "@/lib/insights";

// 篩選前後預算對比：兩條等寬刻度上的對比長條（全部 vs 符合篩選），
// 讓「目前篩選讓多少金額／件數留在工作集」一眼可讀。
// 刻意做成功能性對比長條，而非「大數字＋漸層」的 hero-metric 模板。
export function BudgetCompare({ data }: { data: BeforeAfter }) {
  const { t, lang } = useApp();
  const { beforeBudget, afterBudget, beforeCount, afterCount } = data;
  const afterWidth = beforeBudget ? (afterBudget / beforeBudget) * 100 : 0;
  const retainPct = Math.round(data.budgetRetainedPct);
  const countPct = Math.round(data.countRetainedPct);

  const rows = [
    {
      key: "before",
      label: t("insightsAll"),
      count: beforeCount,
      budget: beforeBudget,
      width: 100,
      fill: "var(--color-ink)",
      fillOpacity: 0.16,
      strong: false,
    },
    {
      key: "after",
      label: t("insightsFiltered"),
      count: afterCount,
      budget: afterBudget,
      width: afterWidth,
      fill: "var(--color-signal)",
      fillOpacity: 1,
      strong: true,
    },
  ];

  return (
    <div className="space-y-4">
      <ul className="space-y-3.5">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1.5 flex items-baseline gap-2 text-[13px]">
              <span className="text-ink-muted">{r.label}</span>
              <span
                className={
                  r.strong
                    ? "tnum ml-auto font-semibold text-ink"
                    : "tnum ml-auto font-medium text-ink-muted"
                }
              >
                {formatBudget(r.budget, lang)}
              </span>
              <span className="tnum w-12 text-right text-xs text-ink-dim">
                {formatInt(r.count, lang)}
                {lang === "zh" ? " 件" : ""}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${Math.max(r.width, r.width > 0 ? 2 : 0)}%`,
                  background: r.fill,
                  opacity: r.fillOpacity,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* 保留比例摘要 */}
      <div className="flex items-center gap-2 border-t border-border pt-3 text-[12px]">
        <span className="text-ink-muted">{t("insightsRetained")}</span>
        <span className="tnum ml-auto font-semibold text-signal">
          {retainPct}%
        </span>
        <span className="text-ink-dim">·</span>
        <span className="tnum text-ink-dim">
          {countPct}% {t("insightsByCount")}
        </span>
      </div>
    </div>
  );
}
