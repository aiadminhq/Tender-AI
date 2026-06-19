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
    <div className="rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-ink-dim/30">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-ink-muted">{label}</span>
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-md",
            accentMap[accent],
          )}
        >
          <Icon size={15} strokeWidth={2} />
        </span>
      </div>
      <div className="tnum mt-2.5 text-[24px] font-semibold leading-none text-ink">
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-ink-dim">{hint}</div>}
    </div>
  );
}
