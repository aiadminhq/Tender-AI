import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// KPI 強調色（克制：圖示底色帶 12% alpha，數字維持 ink）。
const accentMap = {
  signal: "bg-signal/12 text-signal",
  brand: "bg-brand/12 text-brand",
  high: "bg-tier-high/12 text-tier-high",
  mid: "bg-tier-mid/14 text-tier-mid",
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
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: KpiAccent;
  hint?: string;
}) {
  return (
    <div className="group rounded-xl border border-hairline bg-card p-5 shadow-card transition-shadow duration-200 hover:shadow-float">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[13px] font-semibold text-ink-muted">
          {label}
        </span>
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-transform duration-200 group-hover:scale-105",
            accentMap[accent],
          )}
        >
          <Icon size={17} strokeWidth={2.2} />
        </span>
      </div>
      <div className="tnum mt-4 text-[32px] font-bold leading-none text-ink">
        {value.toLocaleString()}
      </div>
      {hint && (
        <div className="mt-2.5 text-[12px] font-medium text-ink-dim">
          {hint}
        </div>
      )}
    </div>
  );
}
