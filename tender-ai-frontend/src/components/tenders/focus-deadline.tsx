import { useApp } from "@/store/app-context";
import { STRINGS } from "@/i18n/strings";
import { formatDate, daysLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

// 今日焦點專用：把「6/22」「3 天」的歧義拆成明確語意——
// 上行「截止 6/22」、下行「剩 3 天 / 已截止 / 無截止」，並沿用既有色階。

/** 明確標示截止日與剩餘天數（解決日期/天數歧義，R6）。 */
export function FocusDeadline({ iso }: { iso?: string }) {
  const { t, lang } = useApp();
  const valid =
    Boolean(iso) && !Number.isNaN(new Date(iso as string).getTime());
  if (!valid) {
    return (
      <span className="text-[12px] text-ink-muted">{t("deadlineNone")}</span>
    );
  }
  const d = daysLeft(iso as string);
  const tone =
    d < 0
      ? "text-ink-muted"
      : d <= 3
        ? "text-tier-low"
        : d <= 7
          ? "text-tier-mid"
          : "text-ink-muted";
  return (
    <div className="flex flex-col gap-0.5 text-right">
      <span className="tnum text-[12px] text-ink">
        {t("deadlineLabel")} {formatDate(iso as string, lang)}
      </span>
      <span className={cn("tnum text-[11px]", tone)}>
        {d < 0 ? t("deadlinePassed") : STRINGS[lang].remainingDays(d)}
      </span>
    </div>
  );
}
