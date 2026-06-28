import { useId } from "react";
import { Flame, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* =========================================================================
   迷你趨勢圖原語（sparkline）—— 跨頁共用，複刻 /knowvio 的呈現手法。
   全部以 currentColor 上色：外層容器給 `text-signal`（淺色橙／深色藍，
   隨主題自動切換），原語本身不寫死 hex，深淺色與其他頁一致。
   ========================================================================= */

interface SparkProps {
  data: number[];
  className?: string;
}

/** 長條 sparkline：最後一根滿色強調、其餘半透明（仿 knowvio BarSpark）。 */
export function BarSpark({ data, className }: SparkProps) {
  const max = Math.max(...data, 1);
  const n = data.length;
  const gap = 3;
  const bw = (88 - gap * (n - 1)) / n;
  return (
    <svg
      viewBox="0 0 88 36"
      className={cn("h-full w-full text-signal", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      {data.map((b, i) => {
        const h = Math.max((b / max) * 32, 2);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={36 - h}
            width={bw}
            height={h}
            rx={2}
            className="fill-current"
            opacity={i === n - 1 ? 1 : 0.4}
          />
        );
      })}
    </svg>
  );
}

/** 折線 sparkline ＋ 面積漸層（仿 knowvio LineSpark）。 */
export function LineSpark({ data, className }: SparkProps) {
  const gid = useId();
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const d = data
    .map((p, i) => {
      const x = (i / (data.length - 1)) * 86 + 1;
      const y = 33 - ((p - min) / span) * 28;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 88 36"
      className={cn("h-full w-full text-signal", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L87 36 L1 36 Z`} fill={`url(#${gid})`} />
      <path
        d={d}
        fill="none"
        className="stroke-current"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 連續達成點（仿 knowvio StreakDots）：亮起 = signal tint，未達 = 中性。 */
export function StreakDots({
  active,
  total = 4,
  icon: Icon = Flame,
  className,
}: {
  active: number;
  total?: number;
  icon?: LucideIcon;
  className?: string;
}) {
  const on = Math.min(Math.max(active, 0), total);
  return (
    <div
      className={cn("flex h-full items-center justify-end gap-1.5", className)}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "grid size-6 place-items-center rounded-full",
            i < on ? "bg-signal/12 text-signal" : "bg-surface-2 text-ink-dim",
          )}
        >
          <Icon size={12} />
        </span>
      ))}
    </div>
  );
}
