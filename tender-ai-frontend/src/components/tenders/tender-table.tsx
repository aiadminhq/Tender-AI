import { useState, type ReactNode } from "react";
import type { Tender } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { STRINGS } from "@/i18n/strings";
import { TenderRow, ROW_GRID } from "./tender-row";
import { TenderDrawer } from "./tender-drawer";
import { cn } from "@/lib/utils";

export function TenderTable({
  tenders,
  caption,
  showCount = true,
  bare = false,
}: {
  tenders: Tender[];
  caption?: ReactNode;
  showCount?: boolean;
  // bare：跳過卡殼與 caption/showCount header（供 MaximizableCard 提供外殼與標題）。
  bare?: boolean;
}) {
  const { t, lang } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 從目前清單查找（live 資料為數字字串 id）；勿用 mock 的 tenderById 否則查無。
  const selected = selectedId
    ? (tenders.find((x) => x.id === selectedId) ?? null)
    : null;

  return (
    <div>
      {!bare && (caption || showCount) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {caption ? (
            <h2 className="text-[14px] font-semibold text-ink">{caption}</h2>
          ) : (
            <span />
          )}
          {showCount && (
            <span className="tnum shrink-0 text-[12px] text-ink-dim">
              {STRINGS[lang].resultCount(tenders.length)}
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          bare
            ? "overflow-hidden"
            : "overflow-hidden rounded-lg border border-border bg-card",
        )}
      >
        {/* 表頭（桌機） */}
        <div
          className={cn(
            "hidden gap-3 border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-dim lg:grid",
            ROW_GRID,
          )}
        >
          <span>{t("colTier")}</span>
          <span>{t("colTender")}</span>
          <span className="text-right">{t("colBudget")}</span>
          <span className="text-right">{t("colDeadline")}</span>
          <span>{t("colFeasibility")}</span>
          <span className="text-center">{t("colOwner")}</span>
          <span />
        </div>

        {tenders.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[13px] font-medium text-ink">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 text-[12px] text-ink-dim">{t("emptyHint")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tenders.map((tender) => (
              <TenderRow
                key={tender.id}
                tender={tender}
                onOpen={setSelectedId}
              />
            ))}
          </div>
        )}
      </div>

      <TenderDrawer tender={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
