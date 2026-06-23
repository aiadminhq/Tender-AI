import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import type { SortKey, Tender } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { STRINGS } from "@/i18n/strings";
import { TenderRow, ROW_GRID } from "./tender-row";
import { TenderDrawer } from "./tender-drawer";
import { cn } from "@/lib/utils";

// 可排序表頭：點擊同欄翻轉升／降冪、換欄套用該欄預設方向（邏輯在 store.toggleSort）。
// 啟用中以 signal 色箭頭標示方向；未啟用欄 hover 才浮現淡色雙向箭頭提示可排序。
function SortHead({
  sortKey,
  label,
  align = "left",
}: {
  sortKey: SortKey;
  label: TextKey;
  align?: "left" | "right" | "center";
}) {
  const { t } = useApp();
  const { filter, toggleSort } = useAppData();
  const active = filter.sort === sortKey;
  const dir = active ? filter.sortDir : null;
  const hint = !active
    ? t("sortInactiveHint")
    : dir === "asc"
      ? t("sortAscHint")
      : t("sortDescHint");
  return (
    <button
      type="button"
      onClick={() => toggleSort(sortKey)}
      title={hint}
      aria-label={`${t(label)}・${hint}`}
      className={cn(
        "group -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        align === "right" && "ml-auto flex-row-reverse",
        align === "center" && "mx-auto",
        active ? "text-ink" : "text-ink-dim",
      )}
    >
      <span>{t(label)}</span>
      {active ? (
        dir === "asc" ? (
          <ChevronUp size={13} className="shrink-0 text-signal" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-signal" />
        )
      ) : (
        <ChevronsUpDown
          size={13}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-45"
        />
      )}
    </button>
  );
}

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
          <SortHead sortKey="budget" label="colBudget" align="right" />
          <SortHead sortKey="deadline" label="colDeadlineDate" align="right" />
          <SortHead sortKey="deadline" label="colDaysLeft" align="right" />
          <SortHead sortKey="feasibility" label="colFeasibility" />
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
