import { ChevronDown, ChevronUp } from "lucide-react";
import type { TextKey } from "@/i18n/strings";
import type { SortDir } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { cn } from "@/lib/utils";
import type { FocusSort } from "@/lib/focus-sort";

// 今日焦點本地排序（不動全域 filter.sort，避免污染 /tenders 列表）。
const OPTIONS: { key: FocusSort; label: TextKey }[] = [
  { key: "feasibility", label: "sortFeasibility" },
  { key: "budget", label: "sortBudget" },
  { key: "deadline", label: "sortDeadline" },
];

/** 今日焦點上方的排序選擇（匹配度 / 金額 / 截止日，R7）。 */
export function FocusSortBar({
  value,
  direction,
  onChange,
  onDirectionChange,
}: {
  value: FocusSort;
  direction: SortDir;
  onChange: (s: FocusSort) => void;
  onDirectionChange: (direction: SortDir) => void;
}) {
  const { t } = useApp();
  const nextDirection = direction === "asc" ? "desc" : "asc";
  const directionHint =
    direction === "asc" ? t("sortAscHint") : t("sortDescHint");
  const DirectionIcon = direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-[11px] font-medium text-ink-dim">{t("sortBy")}</span>
      <div
        role="group"
        aria-label={t("sortBy")}
        className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-0.5"
      >
        {OPTIONS.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.key)}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                active
                  ? "bg-signal/12 text-signal"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {t(o.label)}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        title={directionHint}
        aria-label={directionHint}
        onClick={() => onDirectionChange(nextDirection)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <DirectionIcon size={14} className="text-signal" />
        {direction === "asc" ? t("sortAscending") : t("sortDescending")}
      </button>
    </div>
  );
}
