import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, ArrowRight, Eye } from "lucide-react";
import type { Tender } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { formatBudget, formatDateLong } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Fact,
  LabelTags,
  DaysLeftBanner,
} from "@/components/tenders/detail-bits";
import { FocusDeadline } from "@/components/tenders/focus-deadline";
import { daysLeft } from "@/lib/format";

// 今日焦點單列：精簡 header（密度收斂）＋ 同一張卡內可展開的初步比對面板。
// 不改共用 TenderRow，避免污染 /tenders 列表。

/** 今日焦點單列（R1 密度／R2 同 frame 展開／R3 兩顆入口／R4 多列比對）。 */
export function FocusRow({
  tender,
  expanded,
  onToggle,
  onQuickView,
}: {
  tender: Tender;
  expanded: boolean;
  onToggle: () => void;
  onQuickView: () => void;
}) {
  const { t, lang } = useApp();
  const { feasOf } = useAppData();
  const navigate = useNavigate();
  const score = feasOf(tender).score;
  const dleft = tender.deadline ? daysLeft(tender.deadline) : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      {/* 精簡 header：整列可點切換展開（R1/R2） */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? t("collapseRow") : t("expandRow")}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-accent/50"
      >
        <span className="grid size-5 shrink-0 place-items-center text-ink-dim">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {tender.title}
        </span>
        <span className="tnum shrink-0 rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">
          {score}
        </span>
        <span className="shrink-0">
          <FocusDeadline iso={tender.deadline} />
        </span>
      </button>

      {/* 同卡展開面板：初步比對 + 兩顆入口（R3/R4） */}
      {expanded && (
        <div className="space-y-3 border-t border-hairline px-3 pb-3 pt-2.5">
          <LabelTags tender={tender} lang={lang} t={t} />
          {dleft !== null && <DaysLeftBanner daysLeft={dleft} t={t} />}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
            <Fact label={t("org")}>
              <span className="block truncate">{tender.org}</span>
            </Fact>
            <Fact label={t("publishedAt")} num>
              {formatDateLong(tender.publishedAt, lang)}
            </Fact>
            <Fact label={t("colBudget")} num>
              {formatBudget(tender.budget, lang)}
            </Fact>
            <Fact label={t("colDeadline")} num>
              {formatDateLong(tender.deadline, lang)}
            </Fact>
            {tender.city && <Fact label={t("city")}>{tender.city}</Fact>}
          </dl>
          {/* 動作區：快速預覽＝主行動（開完整資訊彈窗），完整詳情降為次要連結（R3）。 */}
          <div className="flex items-center gap-2 border-t border-hairline pt-3">
            <Button
              variant="primary"
              size="sm"
              onClick={onQuickView}
              className="flex-1 justify-center"
            >
              <Eye size={14} /> {t("quickView")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/tenders/${tender.id}`)}
            >
              {t("viewFullDetail")} <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
