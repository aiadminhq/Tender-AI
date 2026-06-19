import type { ReactNode } from "react";
import type { Lang, TextKey } from "@/i18n/strings";
import type { Category, Tender } from "@/types/domain";
import type { FeasResult } from "@/lib/feasibility";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import { Star, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/ui/tier-badge";
import { sourceByKey } from "@/data/sources";
import { cn } from "@/lib/utils";

// 標案詳情的共用小元件：drawer（peek）與詳情頁共用，避免兩處複製。

/** 事實格：上標籤、下值；num 啟用等寬數字（tnum）。 */
export function Fact({
  label,
  children,
  num,
}: {
  label: string;
  children: ReactNode;
  num?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-dim">{label}</dt>
      <dd className={cn("mt-0.5 text-[13px] text-ink", num && "tnum")}>
        {children}
      </dd>
    </div>
  );
}

/** 量表列：左標籤、右數值 + 進度條。 */
export function MeterRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-ink-muted">{label}</span>
        <span className="tnum text-[12px] font-medium text-ink">{value}</span>
      </div>
      <FeasibilityMeter value={value} />
    </div>
  );
}

/** 區塊小標：全大寫、字距加寬的次級標題。 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
      {children}
    </div>
  );
}

// —— 下方為 Task 6 新增的展示元件 ——

export const CAT_KEY: Record<Category, TextKey> = {
  works: "catWorks",
  goods: "catGoods",
  services: "catServices",
};
const CAT_VARIANT: Record<Category, "signal" | "muted" | "outline"> = {
  works: "signal",
  goods: "muted",
  services: "outline",
};

/** 來源 + 類別色標 + 城市 Badge 列。 */
export function LabelTags({
  tender,
  lang,
  t,
}: {
  tender: Tender;
  lang: Lang;
  t: (k: TextKey) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TierBadge tier={tender.tier} lang={lang} />
      <Badge variant="muted">{sourceByKey(tender.source).shortName}</Badge>
      <Badge variant={CAT_VARIANT[tender.category]}>
        {t(CAT_KEY[tender.category])}
      </Badge>
      {tender.city && <Badge variant="outline">{tender.city}</Badge>}
    </div>
  );
}

/** 可行性分數徽章 + hover tooltip 拆解。 */
export function FeasibilityBadge({
  result,
  t,
}: {
  result: FeasResult;
  t: (k: TextKey) => string;
}) {
  const tip = result.breakdown.length
    ? result.breakdown
        .map((b) => `${b.delta >= 0 ? "+" : ""}${b.delta} ${b.label}`)
        .join("  ")
    : t("feasDefault");
  return (
    <span
      title={`${t("feasBreakdown")}: ${tip}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-ink"
    >
      {t("feasibility")}
      <span className="tnum text-signal">{result.score}</span>
    </span>
  );
}

/** 剩餘 <7 天紅色警示條（含已過）。 */
export function DaysLeftBanner({
  daysLeft,
  t,
}: {
  daysLeft: number;
  t: (k: TextKey) => string;
}) {
  if (daysLeft >= 7) return null;
  const text =
    daysLeft < 0 ? t("deadlinePassed") : `${daysLeft} ${t("daysLeft")}`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] font-medium text-danger">
      <Clock size={14} className="shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** 「待補」佔位（後端尚未吐出的欄位）。 */
export function PlaceholderBlock({
  label,
  t,
}: {
  label: string;
  t: (k: TextKey) => string;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-2 text-[12px] text-ink-dim">
        <span className="mr-1 rounded bg-surface-2 px-1.5 py-0.5">
          {t("pending")}
        </span>
        {t("pendingDesc")}
      </div>
    </div>
  );
}

/** 5★ 可點評價。 */
export function RatingStars({
  value,
  onRate,
}: {
  value: number;
  onRate: (star: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n}`}
          onClick={() => onRate(n)}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-accent"
        >
          <Star
            size={16}
            className={
              n <= value ? "fill-tier-mid text-tier-mid" : "text-ink-dim"
            }
          />
        </button>
      ))}
    </div>
  );
}
