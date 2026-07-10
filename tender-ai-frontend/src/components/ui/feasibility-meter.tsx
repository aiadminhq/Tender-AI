import { cn } from "@/lib/utils";

// 4px 漸層條（綠→藍）。漸層是設計系統少數允許的用途之一。
export function FeasibilityMeter({
  value,
  showLabel = false,
  className,
}: {
  value: number;
  showLabel?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--feasibility-from), var(--feasibility-to))",
          }}
        />
      </div>
      {showLabel && (
        <span className="tnum w-8 shrink-0 text-right text-[12px] font-semibold text-ink">
          {pct}%
        </span>
      )}
    </div>
  );
}
