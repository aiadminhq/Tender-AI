import type { TextKey } from "@/i18n/strings";
import { useApp } from "@/store/app-context";
import { cn } from "@/lib/utils";

// 今日焦點本地排序（不動全域 filter.sort，避免污染 /tenders 列表）。
export type FocusSort = "feasibility" | "budget" | "deadline";

const OPTIONS: { key: FocusSort; label: TextKey }[] = [
  { key: "feasibility", label: "sortFeasibility" },
  { key: "budget", label: "sortBudget" },
  { key: "deadline", label: "sortDeadline" },
];

/** 今日焦點上方的排序選擇（匹配度 / 金額 / 截止日，R7）。 */
export function FocusSortBar({
  value,
  onChange,
}: {
  value: FocusSort;
  onChange: (s: FocusSort) => void;
}) {
  const { t } = useApp();
  return (
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
  );
}
