import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// KPI 強調色：圖示、coverage 與 hover 光暈共用同一語意色。
const accentMap = {
  signal: "bg-signal/12 text-signal",
  high: "bg-tier-high/12 text-tier-high",
  mid: "bg-tier-mid/12 text-tier-mid",
  low: "bg-tier-low/12 text-tier-low",
  priority: "bg-priority/12 text-priority",
  neutral: "bg-surface-2 text-ink-muted",
} as const;

const accentTextMap = {
  signal: "text-signal",
  high: "text-tier-high",
  mid: "text-tier-mid",
  low: "text-tier-low",
  priority: "text-priority",
  neutral: "text-ink-muted",
} as const;

export type KpiAccent = keyof typeof accentMap;

function KpiCoverage({
  value,
  total,
  accent,
  label,
  scopeLabel,
}: {
  value: number;
  total: number;
  accent: KpiAccent;
  label: string;
  scopeLabel: string;
}) {
  const ratio = total > 0 ? Math.min(value / total, 1) : 0;
  const percent = Math.round(ratio * 100);
  const activeSegments = Math.round(ratio * 8);

  return (
    <div
      className="mt-4"
      role="img"
      aria-label={`${label}：${value}/${total}（${percent}%）`}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px]">
        <span className="text-ink-dim">{scopeLabel}</span>
        <span className="tnum font-medium text-ink-muted">
          {percent}% <span className="font-normal text-ink-dim">{value}/{total}</span>
        </span>
      </div>
      <div className="flex h-1.5 gap-1" aria-hidden>
        {Array.from({ length: 8 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "h-full flex-1 rounded-full transition-[opacity,transform] duration-500 ease-out-quart",
              index < activeSegments
                ? cn("bg-current opacity-100", accentTextMap[accent])
                : "bg-surface-2 opacity-70",
            )}
            style={{ transitionDelay: `${index * 35}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "neutral",
  hint,
  suffix,
  scopeTotal,
  scopeLabel,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent?: KpiAccent;
  hint?: string;
  /** 數字後綴（如 % / 天）。 */
  suffix?: string;
  /** 與 KPI 同一資料範圍下的母數；用於呈現可驗證的當前占比。 */
  scopeTotal?: number;
  scopeLabel?: string;
}) {
  const numericValue = typeof value === "number" ? value : Number(value) || 0;

  return (
    <section className="group relative isolate min-h-[164px] overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--elev-rest)] transition-[box-shadow,transform,border-color] duration-300 ease-out-quart hover:-translate-y-0.5 hover:border-ink-dim/40 hover:shadow-[var(--elev-hover)]">
      {/* 取材自 21st animated-card-chart 的分層格線與焦點光暈；僅強化層次，不暗示不存在的歷史趨勢。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--surface-2) 1px, transparent 1px), linear-gradient(to bottom, var(--surface-2) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          maskImage:
            "radial-gradient(ellipse 70% 72% at 75% 100%, black 0%, transparent 74%)",
        }}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-12 -bottom-14 -z-10 size-36 rounded-full blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-35",
          accentMap[accent],
        )}
      />

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ring-ink/5",
            accentMap[accent],
          )}
        >
          <Icon size={15} strokeWidth={2} />
        </span>
        <span className="truncate text-[12px] font-medium text-ink-muted">{label}</span>
        <span
          className={cn(
            "ml-auto size-2 shrink-0 rounded-full shadow-[0_0_0_4px] shadow-current/10",
            accentTextMap[accent],
          )}
          aria-hidden
        />
      </div>

      <div className="mt-5 flex items-end gap-2">
        <div className="tnum text-[30px] font-semibold leading-none tracking-[-0.04em] text-ink">
          {value}
          {suffix && (
            <span className="ml-0.5 text-[14px] font-medium text-ink-dim">
              {suffix}
            </span>
          )}
        </div>
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-ink-dim">{hint}</div>}
      {scopeTotal != null && scopeLabel && (
        <KpiCoverage
          label={label}
          value={numericValue}
          total={scopeTotal}
          accent={accent}
          scopeLabel={scopeLabel}
        />
      )}
    </section>
  );
}
