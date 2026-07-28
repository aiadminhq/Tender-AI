import type { SortDir } from "@/types/domain";

export type FocusSort = "feasibility" | "budget" | "deadline";

export const FOCUS_SORT_DEFAULT_DIR: Record<FocusSort, SortDir> = {
  feasibility: "desc",
  budget: "desc",
  deadline: "desc",
};

type FocusSortItem = {
  budget?: number | null;
  deadline?: string;
};

/**
 * 今日焦點的本地排序。無效或缺少的截止日固定排在最後，
 * 避免切換方向時把未知日期誤列為最高優先。
 */
export function sortFocusItems<T extends FocusSortItem>(
  items: T[],
  sort: FocusSort,
  direction: SortDir,
  feasibilityOf: (item: T) => number,
): T[] {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    if (sort === "deadline") {
      const aTime = deadlineTime(a.deadline);
      const bTime = deadlineTime(b.deadline);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return (aTime - bTime) * multiplier;
    }

    const aValue = sort === "budget" ? (a.budget ?? 0) : feasibilityOf(a);
    const bValue = sort === "budget" ? (b.budget ?? 0) : feasibilityOf(b);
    return (aValue - bValue) * multiplier;
  });
}

function deadlineTime(iso?: string): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}
