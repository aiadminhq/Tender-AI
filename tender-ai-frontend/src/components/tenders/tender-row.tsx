import { useState } from "react";
import { Star, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Tender, Verdict } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { sourceByKey } from "@/data/sources";
import { userById } from "@/data/users";
import { formatBudget, formatDate, daysLeft } from "@/lib/format";
import { TierBadge } from "@/components/ui/tier-badge";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JudgmentReasonDialog } from "@/components/tenders/judgment-reason-dialog";
import { cn } from "@/lib/utils";

// 桌機表格欄寬（與 TenderTable 表頭共用，務必同步）。
// 8 欄：分級／標案／預算／截止日期／剩餘天數／可行性／負責人／操作。
export const ROW_GRID =
  "lg:grid-cols-[76px_minmax(0,1fr)_92px_96px_76px_110px_44px_112px]";

// 後端可能無截止日（deadline_iso=null → adapt 給空字串）。無效日期會讓
// Intl.DateTimeFormat.format(Invalid Date) 拋 RangeError 進而整列崩潰，故先驗證。
function isValidDate(iso: string) {
  return Boolean(iso) && !Number.isNaN(new Date(iso).getTime());
}

// 剩餘天數的緊迫色：逾期淡化、≤3 紅、≤7 黃，其餘中性。
function daysLeftTone(d: number) {
  return d < 0
    ? "text-ink-dim"
    : d <= 3
      ? "text-tier-low"
      : d <= 7
        ? "text-tier-mid"
        : "text-ink-muted";
}

// 桌機：截止日期（獨立欄，可排序）。
function DeadlineDateCell({ iso }: { iso: string }) {
  const { lang } = useApp();
  return (
    <div className="text-right">
      <span className="tnum text-[12px] text-ink">
        {isValidDate(iso) ? formatDate(iso, lang) : "—"}
      </span>
    </div>
  );
}

// 桌機：剩餘天數（獨立欄，可排序；與截止日期同 deadline 排序鍵）。
function DaysLeftCell({ iso }: { iso: string }) {
  const { t } = useApp();
  if (!isValidDate(iso)) {
    return (
      <div className="text-right">
        <span className="tnum text-[12px] text-ink-dim">—</span>
      </div>
    );
  }
  const d = daysLeft(iso);
  return (
    <div className="text-right">
      <span className={cn("tnum text-[12px]", daysLeftTone(d))}>
        {d < 0 ? t("deadlinePassed") : `${d} ${t("daysLeft")}`}
      </span>
    </div>
  );
}

// 手機卡片：截止日期 + 剩餘天數合併直排（維持原行動裝置版面）。
function DeadlineCell({ iso, className }: { iso: string; className?: string }) {
  const { t, lang } = useApp();
  if (!isValidDate(iso)) {
    return (
      <div className={cn("flex flex-col gap-0.5", className)}>
        <span className="tnum text-[12px] text-ink-dim">—</span>
      </div>
    );
  }
  const d = daysLeft(iso);
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="tnum text-[12px] text-ink">{formatDate(iso, lang)}</span>
      <span className={cn("tnum text-[11px]", daysLeftTone(d))}>
        {d < 0 ? t("deadlinePassed") : `${d} ${t("daysLeft")}`}
      </span>
    </div>
  );
}

// 三分判斷鈕（✓ 可行 / ✗ 不可行 / ⭐ 精選）。任一鍵都先開「大致原因」表單，
// 確認後才經 store.judge() 寫入 Layer B 並即時併入 Layer C（見 JudgmentReasonDialog）。
// 共用於桌機列、行動卡片與今日焦點列（收合即顯）。
export function JudgmentActions({ tender }: { tender: Tender }) {
  const { t } = useApp();
  const { verdictOf } = useAppData();
  const current = verdictOf(tender.id);
  const [pending, setPending] = useState<Verdict | null>(null);

  const buttons: {
    verdict: Verdict;
    icon: typeof ThumbsUp;
    tip: string;
    on: string;
    off: string;
  }[] = [
    {
      verdict: "feasible",
      icon: ThumbsUp,
      tip: t("judgeTipFeasible"),
      on: "bg-success/15 text-success",
      off: "text-ink-dim hover:text-success",
    },
    {
      verdict: "infeasible",
      icon: ThumbsDown,
      tip: t("judgeTipInfeasible"),
      on: "bg-danger/15 text-danger",
      off: "text-ink-dim hover:text-danger",
    },
    {
      verdict: "featured",
      icon: Star,
      tip: t("judgeTipFeatured"),
      on: "bg-priority/15 text-priority",
      off: "text-ink-dim hover:text-priority",
    },
  ];

  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {buttons.map(({ verdict, icon: Icon, tip, on, off }) => {
        const active = current === verdict;
        return (
          <Button
            key={verdict}
            variant="ghost"
            size="icon-sm"
            aria-label={tip}
            aria-pressed={active}
            title={tip}
            className={active ? on : off}
            onClick={() => setPending(verdict)}
          >
            <Icon
              size={15}
              className={cn(
                active && verdict === "featured" && "fill-priority",
              )}
            />
          </Button>
        );
      })}
      {pending && (
        <JudgmentReasonDialog
          verdict={pending}
          tenderId={tender.id}
          title={tender.title}
          onResolved={() => setPending(null)}
        />
      )}
    </div>
  );
}

function OwnerCell({ ownerId }: { ownerId?: string }) {
  const u = userById(ownerId);
  if (!u) return <span className="text-[12px] text-ink-dim">—</span>;
  return <Avatar user={u} size="sm" />;
}

export function TenderRow({
  tender,
  onOpen,
}: {
  tender: Tender;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useApp();
  const { isExcluded, excludeReasonOf } = useAppData();
  const excluded = isExcluded(tender);
  const reason = excluded ? excludeReasonOf(tender) : undefined;
  const source = sourceByKey(tender.source).shortName;

  return (
    <>
      {/* 桌機：表格列 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(tender.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(tender.id);
          }
        }}
        className={cn(
          "hidden cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none lg:grid",
          ROW_GRID,
          excluded && "opacity-60",
        )}
      >
        <div>
          <TierBadge tier={tender.tier} lang={lang} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink">
            {tender.title}
          </div>
          <div className="truncate text-[11px] text-ink-dim">
            {tender.org} · {source}
            {reason ? ` · ${reason}` : ""}
          </div>
        </div>
        <div className="tnum text-right text-[12px] text-ink">
          {formatBudget(tender.budget, lang)}
        </div>
        <DeadlineDateCell iso={tender.deadline} />
        <DaysLeftCell iso={tender.deadline} />
        <FeasibilityMeter value={tender.feasibility} showLabel />
        <div className="flex justify-center">
          <OwnerCell ownerId={tender.owner} />
        </div>
        <JudgmentActions tender={tender} />
      </div>

      {/* 行動裝置：卡片列 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(tender.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(tender.id);
          }
        }}
        className={cn(
          "cursor-pointer p-3 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none lg:hidden",
          excluded && "opacity-60",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <TierBadge tier={tender.tier} lang={lang} />
          <span className="tnum shrink-0 text-[12px] text-ink-muted">
            {formatBudget(tender.budget, lang)}
          </span>
        </div>
        <div className="mt-1.5 line-clamp-2 text-[13px] font-medium text-ink">
          {tender.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-ink-dim">
          {tender.org} · {source}
        </div>
        {excluded ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="danger">{t("excluded")}</Badge>
            {reason && (
              <span className="text-[11px] text-ink-dim">{reason}</span>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <DeadlineCell iso={tender.deadline} />
            <FeasibilityMeter
              value={tender.feasibility}
              showLabel
              className="max-w-[140px]"
            />
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <OwnerCell ownerId={tender.owner} />
          <JudgmentActions tender={tender} />
        </div>
      </div>
    </>
  );
}
