import { useMemo, useState } from "react";
import type { Tender } from "@/types/domain";
import { useAppData } from "@/store/app-data";
import { daysLeft } from "@/lib/format";
import {
  FocusSortBar,
  type FocusSort,
} from "@/components/tenders/focus-sort-bar";
import { FocusRow } from "@/components/tenders/focus-row";
import { TenderDrawer } from "@/components/tenders/tender-drawer";

// 今日焦點專用列表（取代 <TenderTable bare>）：
// 本地排序（不動全域 filter.sort）＋ 同卡可多列展開 ＋ 共用 TenderDrawer 作快速預覽入口。

/** 今日焦點列表（R1 密度／R2+R4 多列就地展開／R3 兩顆入口／R7 本地排序）。 */
export function FocusList({ tenders }: { tenders: Tender[] }) {
  const { feasOf } = useAppData();
  const [sort, setSort] = useState<FocusSort>("feasibility");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // 本地排序：匹配度（feasOf().score）由高到低；金額由高到低；截止日由近到遠。
  const sorted = useMemo(() => {
    const list = [...tenders];
    switch (sort) {
      case "budget":
        return list.sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0));
      case "deadline":
        return list.sort(
          (a, b) => deadlineRank(a.deadline) - deadlineRank(b.deadline),
        );
      case "feasibility":
      default:
        return list.sort((a, b) => feasOf(b).score - feasOf(a).score);
    }
  }, [tenders, sort, feasOf]);

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
        <FocusSortBar value={sort} onChange={setSort} />
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

// 截止日排序鍵：無截止／無效日期排到最後（近到遠）。
function deadlineRank(iso?: string): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return daysLeft(iso);
}
