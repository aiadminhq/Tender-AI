// 指揮中心右欄「情境工作區」：帶出當前正在檢視的標案（概況 / 可行性 / 相似案 / 快速動作）。
// 純前端、免 migration——只讀前端既有的 Tender 物件與既有 fetchSimilarTenders API，
// 不改後端、也不把 tender_id 接進對話檢索（那是 Phase 3）。重用 detail-bits 的
// Fact / MeterRow / SectionLabel / SimilarCasesList，與標案詳情頁同一套視覺語彙。
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, FileSearch, Star } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { trackEvent } from "@/lib/events";
import { fetchSimilarTenders, type SimilarTender } from "@/lib/api";
import { sourceByKey } from "@/data/sources";
import { formatBudget, formatDateLong, daysLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { TierBadge } from "@/components/ui/tier-badge";
import {
  Fact,
  MeterRow,
  SectionLabel,
  SimilarCasesList,
} from "@/components/tenders/detail-bits";

interface AssistantContextPanelProps {
  /** 目前正在檢視的標案 id；null（首頁等非標案頁）→ 空態。 */
  tenderId: string | null;
  /** 任一導去他處的動作（承接、開詳情、點相似案）後回呼，通常用來收合浮窗。 */
  onAct?: () => void;
}

export function AssistantContextPanel({
  tenderId,
  onAct,
}: AssistantContextPanelProps) {
  const { t, lang } = useApp();
  const { tenders, isStarred, toggleStar, accept } = useAppData();
  const view = tenderId ? tenders.find((x) => x.id === tenderId) : undefined;

  const [similar, setSimilar] = useState<SimilarTender[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);

  useEffect(() => {
    if (!view) {
      setSimilar([]);
      return;
    }
    const ac = new AbortController();
    setSimilarLoading(true);
    fetchSimilarTenders(view.id, 4, ac.signal)
      .then((items) => setSimilar(items))
      .catch(() => {
        if (!ac.signal.aborted) setSimilar([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setSimilarLoading(false);
      });
    return () => ac.abort();
  }, [view]);

  if (!view) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-1 text-ink-dim">
          <FileSearch size={22} />
        </span>
        <p className="text-[14px] font-medium text-ink">
          {t("assistantContextEmptyTitle")}
        </p>
        <p className="max-w-xs text-[12px] leading-relaxed text-ink-muted">
          {t("assistantContextEmpty")}
        </p>
      </div>
    );
  }

  const starred = isStarred(view.id);
  const dleft = daysLeft(view.deadline);
  const deadlineTone =
    dleft < 0
      ? "text-ink-dim"
      : dleft <= 3
        ? "text-tier-low"
        : dleft <= 7
          ? "text-tier-mid"
          : "text-ink-muted";

  return (
    <div className="space-y-5 px-5 py-5">
      {/* 頭部：層級 + 來源 + 標題 + 機關 */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <TierBadge tier={view.tier} lang={lang} />
          <span className="text-[11px] text-ink-dim">
            {sourceByKey(view.source).shortName}
          </span>
        </div>
        <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-ink">
          {view.title}
        </h2>
        <p className="truncate text-[12px] text-ink-muted">{view.org}</p>
      </header>

      {/* 概況 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <SectionLabel>{t("overview")}</SectionLabel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label={t("colBudget")} num>
            {formatBudget(view.budget, lang)}
          </Fact>
          <Fact label={t("colDeadline")} num>
            {formatDateLong(view.deadline, lang)}
            <span className={cn("ml-1.5 text-[11px]", deadlineTone)}>
              {dleft < 0 ? t("deadlinePassed") : `${dleft} ${t("daysLeft")}`}
            </span>
          </Fact>
        </dl>
        <div className="mt-4 space-y-3">
          <MeterRow
            label={t("supplierCoverage")}
            value={view.supplierCoverage}
          />
          <MeterRow label={t("feasibility")} value={view.feasibility} />
        </div>
      </section>

      {/* 相似案 */}
      <section>
        <SectionLabel>{t("similarCases")}</SectionLabel>
        <SimilarCasesList
          items={similar}
          loading={similarLoading}
          t={t}
          onSelect={onAct}
        />
      </section>

      {/* 快速動作 */}
      <section>
        <SectionLabel>{t("assistantContextActions")}</SectionLabel>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() => {
              accept(view.id);
              onAct?.();
            }}
          >
            <Check size={15} /> {t("accept")}
          </Button>
          <Button variant="outline" onClick={() => toggleStar(view.id)}>
            <Star
              size={15}
              className={cn(starred && "fill-tier-mid text-tier-mid")}
            />
            {starred ? t("unstar") : t("star")}
          </Button>
          <Link
            to={`/tenders/${view.id}`}
            onClick={() => onAct?.()}
            className={cn(buttonVariants({ variant: "ghost" }))}
          >
            <FileSearch size={15} /> {t("assistantOpenDetail")}
          </Link>
          {view.link && (
            <a
              href={view.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("click_link", { tenderId: view.id })}
              className={cn(buttonVariants({ variant: "ghost" }))}
            >
              <ExternalLink size={15} /> {t("sourcePage")}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
