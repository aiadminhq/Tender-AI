import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: KpiAccent;
  hint?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-br from-card/95 via-card to-card/80 p-6 shadow-md transition-all duration-300 hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/20 hover:-translate-y-1">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 transition-all duration-300 group-hover:bg-primary/10" />
      <div className="relative flex items-center justify-between gap-3">
        <span className="truncate text-[13px] font-semibold text-ink-muted transition-colors duration-200 group-hover:text-ink">
          {label}
        </span>
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-md transition-all duration-200 group-hover:scale-120 group-hover:shadow-lg",
            accentMap[accent],
          )}
        >
          <Icon size={18} strokeWidth={2.3} />
        </span>
      </div>
      <div className="tnum relative mt-4 text-4xl font-bold leading-tight text-ink transition-colors duration-200 group-hover:text-primary">
        {value.toLocaleString()}
      </div>
      {hint && (
        <div className="mt-3 text-[12px] font-medium text-ink-dim/70 transition-colors duration-200 group-hover:text-ink-dim">
          {hint}
        </div>
      )}
    </div>
  );
}
