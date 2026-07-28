import { useMemo, useState } from "react";
import type { SortDir, Tender } from "@/types/domain";
import { useAppData } from "@/store/app-data";
import { FocusSortBar } from "@/components/tenders/focus-sort-bar";
import { FocusRow } from "@/components/tenders/focus-row";
import { TenderDrawer } from "@/components/tenders/tender-drawer";
import {
  FOCUS_SORT_DEFAULT_DIR,
  sortFocusItems,
  type FocusSort,
} from "@/lib/focus-sort";

// 今日焦點專用列表（取代 <TenderTable bare>）：
// 本地排序（不動全域 filter.sort）＋ 同卡可多列展開 ＋ 共用 TenderDrawer 作快速預覽入口。

/** 今日焦點列表（R1 密度／R2+R4 多列就地展開／R3 兩顆入口／R7 本地排序）。 */
export function FocusList({
  tenders,
  limit = 8,
}: {
  tenders: Tender[];
  limit?: number;
}) {
  const { feasOf } = useAppData();
  const [sort, setSort] = useState<FocusSort>("deadline");
  const [sortDirection, setSortDirection] = useState<SortDir>(
    FOCUS_SORT_DEFAULT_DIR.deadline,
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // 先依使用者指定的對象與方向排序，再截取首頁顯示筆數。
  const sorted = useMemo(
    () =>
      sortFocusItems(
        tenders,
        sort,
        sortDirection,
        (tender) => feasOf(tender).score,
      ).slice(0, limit),
    [tenders, sort, sortDirection, feasOf, limit],
  );

  const changeSort = (nextSort: FocusSort) => {
    setSort(nextSort);
    setSortDirection(FOCUS_SORT_DEFAULT_DIR[nextSort]);
  };

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const drawerTender = drawerId
    ? (tenders.find((x) => x.id === drawerId) ?? null)
    : null;

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <FocusSortBar
          value={sort}
          direction={sortDirection}
          onChange={changeSort}
          onDirectionChange={setSortDirection}
        />
      </div>
      <div className="space-y-1.5">
        {sorted.map((tender) => (
          <FocusRow
            key={tender.id}
            tender={tender}
            expanded={expandedIds.has(tender.id)}
            onToggle={() => toggle(tender.id)}
            onQuickView={() => setDrawerId(tender.id)}
          />
        ))}
      </div>
      <TenderDrawer tender={drawerTender} onClose={() => setDrawerId(null)} />
    </div>
  );
}
