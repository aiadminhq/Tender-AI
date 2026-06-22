import { useMemo } from "react";
import { PieChart } from "lucide-react";
import { useApp } from "@/store/app-context";

// 通用環圈圖（donut）：複用 dashboard/category-chart 的 SVG 數學，
// 但改為「資料驅動」——由呼叫端傳入已算好的切片，可重用於類別／來源等任意維度。
// 純 inline SVG（無第三方圖表庫），色彩走設計系統 token。
export interface DonutSegment {
  key: string;
  label: string;
  color: string;
  count: number;
  /** 件數佔比（0..1） */
  frac: number;
}

const R = 42; // 半徑（viewBox 0..120）
const STROKE = 15; // 環圈厚度
const C = 2 * Math.PI * R; // 圓周長
const GAP = 2.5; // 段間留白（沿圓周，user units）

export function InsightDonut({
  segments,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerLabel: string;
}) {
  const { t } = useApp();

  const { arcs, total } = useMemo(() => {
    const total = segments.reduce((s, x) => s + x.count, 0);
    let acc = 0;
    const arcs = segments
      .filter((s) => s.count > 0)
      .map((s) => {
        const len = s.frac * C;
        const start = acc;
        acc += len;
        return { key: s.key, color: s.color, len, start };
      });
    return { arcs, total };
  }, [segments]);

  // 空狀態：無資料時不渲染空環圈，改以教學式提示說明此圖隨篩選即時反映。
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-hairline">
          <PieChart size={20} strokeWidth={1.5} className="text-ink-dim" />
        </div>
        <p className="text-[13px] font-medium text-ink">{t("emptyTitle")}</p>
        <p className="max-w-[220px] text-[12px] text-ink-dim">
          {t("emptyHint")}
        </p>
      </div>
    );
  }

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
            {centerLabel}
          </span>
        </div>
      </div>

      {/* 圖例：色點 · 名稱 · 件數 · 佔比 */}
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
              <span className="text-ink-muted">{s.label}</span>
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
