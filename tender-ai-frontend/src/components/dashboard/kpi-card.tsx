import type { LucideIcon, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendBadge } from "@/components/ui/trend-badge";

// KPI 強調色（克制：圖示底色帶 12% alpha，數字維持 ink）。
const accentMap = {
  signal: "bg-signal/12 text-signal",
  high: "bg-tier-high/12 text-tier-high",
  mid: "bg-tier-mid/12 text-tier-mid",
  low: "bg-tier-low/12 text-tier-low",
  priority: "bg-priority/12 text-priority",
  neutral: "bg-surface-2 text-ink-muted",
} as const;

export type KpiAccent = keyof typeof accentMap;

export function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "neutral",
  hint,
  delta,
  suffix,
  spark,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent?: KpiAccent;
  hint?: string;
  /** 趨勢百分比（示意），給定才顯示綠/紅趨勢徽章。 */
  delta?: number;
  /** 數字後綴（如 % / 天）。 */
  suffix?: string;
  /** 迷你趨勢圖（BarSpark / LineSpark / StreakDots）。 */
  spark?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--card-shadow)] transition-colors duration-150 hover:border-ink-dim/30">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            accentMap[accent],
          )}
        >
          <Icon size={15} strokeWidth={2} />
        </span>
        <span className="truncate text-[12px] text-ink-muted">{label}</span>
        {delta != null && (
          <TrendBadge delta={delta} className="ml-auto shrink-0" />
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="tnum text-[24px] font-semibold leading-none text-ink">
          {value}
          {suffix && (
            <span className="ml-0.5 text-[14px] font-medium text-ink-dim">
              {suffix}
            </span>
          )}
        </div>
        {spark && <div className="h-9 w-[84px] shrink-0">{spark}</div>}
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-ink-dim">{hint}</div>}
    </div>
  );
}
