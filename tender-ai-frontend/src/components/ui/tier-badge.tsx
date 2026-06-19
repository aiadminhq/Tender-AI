import { cn } from "@/lib/utils";
import type { Tier } from "@/types/domain";
import { STRINGS, type Lang } from "@/i18n/strings";

const tierMap: Record<
  Tier,
  { cls: string; dot: string; key: "tierHigh" | "tierMid" | "tierLow" }
> = {
  high: {
    cls: "bg-tier-high/12 text-tier-high",
    dot: "bg-tier-high",
    key: "tierHigh",
  },
  mid: {
    cls: "bg-tier-mid/12 text-tier-mid",
    dot: "bg-tier-mid",
    key: "tierMid",
  },
  low: {
    cls: "bg-tier-low/12 text-tier-low",
    dot: "bg-tier-low",
    key: "tierLow",
  },
};

export function TierBadge({
  tier,
  lang,
  className,
}: {
  tier: Tier;
  lang: Lang;
  className?: string;
}) {
  const m = tierMap[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        m.cls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {STRINGS[lang][m.key]}
    </span>
  );
}
