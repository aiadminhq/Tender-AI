import { useMemo } from "react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import type { Category } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";

// 標案類型分佈：工程／財物／勞務 的環圈圖（donut）。
// 取代原本難以解讀的折線趨勢圖，直接呈現業務最關心的類型結構。
// 純 inline SVG（無第三方圖表庫），色彩走設計系統 token；
// 資料取自 filteredTenders，隨全域篩選即時反映目前工作集。
const CATS: { key: Category; color: string; labelKey: TextKey }[] = [
  { key: "works", color: "var(--color-signal)", labelKey: "catWorks" },
  { key: "goods", color: "var(--color-priority)", labelKey: "catGoods" },
  { key: "services", color: "var(--color-tier-mid)", labelKey: "catServices" },
];

const R = 42; // 半徑（viewBox 0..120）
const STROKE = 15; // 環圈厚度
const C = 2 * Math.PI * R; // 圓周長
const GAP = 2.5; // 段間留白（沿圓周，user units）

export function CategoryChart() {
  const { t } = useApp();
  const { filteredTenders } = useAppData();

  // 計數 + 預先算好每段弧長與起始位移（rotate(-90) 讓 0 點在 12 點鐘、順時針）。
  const { arcs, segments, total } = useMemo(() => {
    const counts: Record<Category, number> = {
      works: 0,
      goods: 0,
      services: 0,
    };
    for (const x of filteredTenders) counts[x.category] += 1;
    const total = filteredTenders.length;
    const segments = CATS.map((c) => ({
      ...c,
      count: counts[c.key],
      frac: total ? counts[c.key] / total : 0,
    }));
    let acc = 0;
    const arcs = segments
      .filter((s) => s.count > 0)
      .map((s) => {
        const len = s.frac * C;
        const start = acc;
        acc += len;
        return { key: s.key, color: s.color, len, start };
      });
    return { arcs, segments, total };
  }, [filteredTenders]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
      <div className="relative h-40 w-40 shrink-0 p-3">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          {/* 底環 */}
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="var(--color-surface-2)"
            strokeWidth={STROKE}
          />
          {arcs.map((a) => {
            const dash = Math.max(a.len - GAP, 0.75);
            return (
              <circle
                key={a.key}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={a.color}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-a.start}
                opacity={0.95}
              />
            );
          })}
        </svg>
        {/* 中央總數（疊在 SVG 上、不受旋轉影響） */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-3xl font-bold leading-none text-ink">
            {total}
          </span>
          <span className="mt-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            {t("catTotal")}
          </span>
        </div>
      </div>

      {/* 圖例：色點 · 類型 · 件數 · 佔比 */}
      <ul className="min-w-[180px] space-y-3">
        {segments.map((s) => {
          const pct = total ? Math.round(s.frac * 100) : 0;
          return (
            <li
              key={s.key}
              className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2/60"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full transition-transform duration-150 group-hover:scale-125"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="text-sm font-medium text-ink-muted group-hover:text-ink transition-colors">
                {t(s.labelKey)}
              </span>
              <span className="tnum ml-auto font-semibold text-ink">
                {s.count}
              </span>
              <span className="tnum w-10 text-right text-xs font-medium text-ink-muted">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
