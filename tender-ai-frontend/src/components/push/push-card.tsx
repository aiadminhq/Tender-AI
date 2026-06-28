// 推播卡（共用）：通知面板（push-bell）與推播工作頁（push-page）共用同一張卡。
// 內容皆為 Layer A 安全欄位（標案公開資料 + 可解釋分數/理由），不含人名／email。
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { TierBadge } from "@/components/ui/tier-badge";
import { useApp } from "@/store/app-context";
import { formatBudget } from "@/lib/format";
import type { PushItem } from "@/lib/push";
import type { Lang } from "@/i18n/strings";
import { cn } from "@/lib/utils";

// 標的類別（後端原始中文）→ 色票。對齊標案列表的工程/勞務/財物配色。
const CATEGORY_CLS: Record<string, string> = {
  工程: "bg-tier-mid/12 text-tier-mid",
  勞務: "bg-primary/12 text-primary",
  財物: "bg-tier-high/12 text-tier-high",
};

// 資料源 → 色票。PCC（政府電子採購網）／TMU（北醫聯合採購）。
const SOURCE_CLS: Record<string, string> = {
  PCC: "bg-primary/12 text-primary",
  TMU: "bg-tier-mid/12 text-tier-mid",
};

export function PushCard({
  item,
  lang,
  onClick,
}: {
  item: PushItem;
  lang: Lang;
  onClick: () => void;
}) {
  const { t } = useApp();
  const isNew = item.status === "pending";
  const score = item.score != null ? Math.round(item.score) : null;
  const days = item.daysLeft;
  const daysTone =
    days == null
      ? "text-ink-dim"
      : days < 0
        ? "text-ink-dim"
        : days <= 7
          ? "text-danger"
          : "text-ink-muted";

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border bg-white px-3.5 py-3 text-left shadow-[0_12px_28px_-24px_rgba(15,23,42,.55)] transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_18px_34px_-24px_rgba(15,23,42,.65)] active:translate-y-0",
        isNew ? "border-orange-200" : "border-border",
      )}
    >
      {/* 頂列：tier + 符合度 + 新標記 */}
      <div className="flex items-center gap-2">
        {item.tier && <TierBadge tier={item.tier} lang={lang} />}
        {score != null && (
          <span className="text-[11px] font-medium text-ink-muted">
            {t("pushMatch")} {score}%
          </span>
        )}
        {isNew && (
          <span className="ml-auto rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
            {t("pushNew")}
          </span>
        )}
      </div>

      {/* 標案名稱 */}
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground group-hover:text-primary">
          {item.name ?? `#${item.tenderId ?? "-"}`}
        </span>
        {item.link && (
          <ExternalLink
            size={13}
            className="mt-0.5 shrink-0 text-ink-dim group-hover:text-primary"
          />
        )}
      </div>

      {/* 標籤列：來源 / 類別 / 城市 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {item.source && (
          <Chip
            className={SOURCE_CLS[item.source] ?? "bg-accent text-ink-muted"}
          >
            {item.source}
          </Chip>
        )}
        {item.category && (
          <Chip
            className={
              CATEGORY_CLS[item.category] ?? "bg-accent text-ink-muted"
            }
          >
            {item.category}
          </Chip>
        )}
        {item.city && (
          <Chip className="bg-accent text-ink-muted">{item.city}</Chip>
        )}
      </div>

      {/* 機關 + 預算 + 截止 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-dim">
        {item.org && <span className="truncate">{item.org}</span>}
        {item.budgetWan != null && (
          <span>{formatBudget(item.budgetWan * 10000, lang)}</span>
        )}
        {item.deadlineRoc && (
          <span className={daysTone}>
            {item.deadlineRoc}
            {days != null &&
              days >= 0 &&
              ` · ${days}${lang === "en" ? "d" : " 天"}`}
          </span>
        )}
      </div>

      {/* 推播理由（Layer A 可解釋聚合，不含 PII） */}
      {item.reason && (
        <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink-dim">
            {t("pushReasonLabel")}：
          </span>
          {item.reason}
        </p>
      )}
    </button>
  );
}

function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}
