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
    <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
      <div className="relative h-36 w-36 shrink-0">
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
              />
            );
          })}
        </svg>
        {/* 中央總數（疊在 SVG 上、不受旋轉影響） */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-2xl font-semibold leading-none text-ink">
            {total}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-wide text-ink-dim">
            {t("catTotal")}
          </span>
        </div>
      </div>

      {/* 圖例：色點 · 類型 · 件數 · 佔比 */}
      <ul className="min-w-[160px] space-y-2.5">
        {segments.map((s) => {
          const pct = total ? Math.round(s.frac * 100) : 0;
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="text-ink-muted">{t(s.labelKey)}</span>
              <span className="tnum ml-auto font-medium text-ink">
                {s.count}
              </span>
              <span className="tnum w-9 text-right text-xs text-ink-dim">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
