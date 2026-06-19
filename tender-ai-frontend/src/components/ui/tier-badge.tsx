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
        "inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm transition-all duration-150 hover:shadow-md",
        m.cls,
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full shadow-sm", m.dot)} />
      {STRINGS[lang][m.key]}
    </span>
  );
}
