// 投標看板的純邏輯（無 React／無 I/O），抽出以便 vitest 直接測試。
// 對應 app-data 的：① 舊看板卡遷移 cardsToProjects ② Issue #1 白名單指派名單
// ③ visibleProjects 檢視過濾（stage / member / mineOnly）。
import type {
  BidStage,
  BoardView,
  KanbanCard,
  Member,
  TaskStatus,
  TenderProject,
} from "@/types/domain";

// 舊 KanbanCard.status → 新 BidStage（一次性遷移；done 視為得標，無對應 abandoned）。
export const STAGE_FROM_STATUS: Record<TaskStatus, BidStage> = {
  todo: "watching",
  doing: "preparing",
  review: "submitted",
  done: "won",
};

// 首跑由舊看板卡遷移為投標專案；ownerId 設 null（舊 assignee 為 string id 無法對應 number）。
// 另補種 won/abandoned 各一筆，讓五欄首次開啟都有內容並示範子任務／指派。
// ts 由呼叫端傳入（app-data 給 nowISO()），保持本函式純粹、可決定性測試。
export function cardsToProjects(
  cards: KanbanCard[],
  ts: string,
): TenderProject[] {
  const fromCards: TenderProject[] = cards.map((c, i) => ({
    id: `p-seed-${i}`,
    tenderId: c.tenderId,
    title: c.title,
    stage: STAGE_FROM_STATUS[c.status],
    tier: c.tier,
    deadline: c.deadline,
    ownerId: null,
    subtasks: [],
    notes: c.notes ?? [],
    createdAt: ts,
    updatedAt: ts,
  }));
  const extra: TenderProject[] = [
    {
      id: "p-seed-won",
      title: "市立圖書館空調系統汰換統包",
      stage: "won",
      tier: "high",
      ownerId: 2,
      subtasks: [
        {
          id: "st-seed-w1",
          title: "簽約與備查文件",
          status: "done",
          assigneeId: 3,
          priority: "mid",
          createdBy: 1,
          createdAt: ts,
        },
        {
          id: "st-seed-w2",
          title: "施工排程與進場協調",
          status: "doing",
          assigneeId: 4,
          priority: "high",
          createdBy: 1,
          createdAt: ts,
        },
      ],
      notes: [],
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "p-seed-abandon",
      title: "某機關清潔勞務（不符承作範圍）",
      stage: "abandoned",
      tier: "low",
      ownerId: 3,
      subtasks: [],
      notes: [],
      createdAt: ts,
      updatedAt: ts,
    },
  ];
  return [...fromCards, ...extra];
}

// Issue #1 指派名單唯一來源：僅白名單成員（whitelistActive）才可被指派。
export function filterAssignableMembers(members: Member[]): Member[] {
  return members.filter((m) => m.whitelistActive);
}

// 單一專案是否通過目前 boardView 過濾（階段 / 成員 / 與我相關）。
// memberFilter 與 mineOnly 的「相關」定義一致：負責人 or 任一子任務被指派者。
export function isProjectVisible(
  p: TenderProject,
  view: BoardView,
  currentMemberId: number | null,
): boolean {
  if (view.stageFilter && p.stage !== view.stageFilter) return false;
  if (view.memberFilter != null) {
    const mid = view.memberFilter;
    const involved =
      p.ownerId === mid || p.subtasks.some((s) => s.assigneeId === mid);
    if (!involved) return false;
  }
  if (view.mineOnly) {
    if (currentMemberId == null) return false;
    const mine =
      p.ownerId === currentMemberId ||
      p.subtasks.some((s) => s.assigneeId === currentMemberId);
    if (!mine) return false;
  }
  return true;
}

export function filterVisibleProjects(
  projects: TenderProject[],
  view: BoardView,
  currentMemberId: number | null,
): TenderProject[] {
  return projects.filter((p) => isProjectVisible(p, view, currentMemberId));
}
