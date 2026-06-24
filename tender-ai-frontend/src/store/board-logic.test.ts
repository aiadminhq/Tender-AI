import { describe, it, expect } from "vitest";
import {
  STAGE_FROM_STATUS,
  cardsToProjects,
  filterAssignableMembers,
  isProjectVisible,
  filterVisibleProjects,
} from "./board-logic";
import type {
  BoardView,
  KanbanCard,
  Member,
  Subtask,
  TenderProject,
} from "@/types/domain";

const TS = "2026-06-24T00:00:00.000Z";

const mkMember = (id: number, whitelistActive: boolean): Member => ({
  id,
  name: `M${id}`,
  email: `m${id}@hqdesign.tw`,
  role: "member",
  whitelistActive,
  consentShared: false,
  initials: `M${id}`,
  color: "#888888",
});

const mkSub = (assigneeId: number | null): Subtask => ({
  id: `s-${assigneeId ?? "none"}`,
  title: "sub",
  status: "todo",
  assigneeId,
  createdAt: TS,
});

const proj = (over: Partial<TenderProject>): TenderProject => ({
  id: "p",
  title: "專案",
  stage: "watching",
  subtasks: [],
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

describe("cardsToProjects", () => {
  const cards: KanbanCard[] = [
    {
      id: "c1",
      title: "A",
      status: "todo",
      tenderId: "t-1",
      tier: "high",
      notes: [{ id: "n1", author: "x", createdAt: TS, body: "hi" }],
    },
    { id: "c2", title: "B", status: "doing" },
    { id: "c3", title: "C", status: "review" },
    { id: "c4", title: "D", status: "done" },
  ];

  it("把每張舊看板卡的 status 依 STAGE_FROM_STATUS 映射為 BidStage", () => {
    const out = cardsToProjects(cards, TS);
    const fromCards = out.slice(0, cards.length);
    expect(fromCards.map((p) => p.stage)).toEqual([
      STAGE_FROM_STATUS.todo,
      STAGE_FROM_STATUS.doing,
      STAGE_FROM_STATUS.review,
      STAGE_FROM_STATUS.done,
    ]);
    expect(fromCards.map((p) => p.stage)).toEqual([
      "watching",
      "preparing",
      "submitted",
      "won",
    ]);
  });

  it("遷移卡 ownerId 一律為 null（舊 string assignee 無法對應 number id）", () => {
    const out = cardsToProjects(cards, TS);
    for (const p of out.slice(0, cards.length)) {
      expect(p.ownerId).toBeNull();
      expect(p.subtasks).toEqual([]);
      expect(p.createdAt).toBe(TS);
      expect(p.updatedAt).toBe(TS);
    }
  });

  it("沿用 tenderId / tier / notes；無 notes 的卡退化為空陣列", () => {
    const out = cardsToProjects(cards, TS);
    expect(out[0].tenderId).toBe("t-1");
    expect(out[0].tier).toBe("high");
    expect(out[0].notes).toHaveLength(1);
    expect(out[1].notes).toEqual([]);
  });

  it("另補種 won / abandoned 各一筆，讓五欄首跑都有內容並示範子任務／指派", () => {
    const out = cardsToProjects(cards, TS);
    expect(out).toHaveLength(cards.length + 2);
    const won = out.find((p) => p.id === "p-seed-won");
    const abandon = out.find((p) => p.id === "p-seed-abandon");
    expect(won?.stage).toBe("won");
    expect(won?.subtasks).toHaveLength(2);
    expect(won?.ownerId).toBe(2);
    expect(abandon?.stage).toBe("abandoned");
  });
});

describe("filterAssignableMembers", () => {
  it("只回傳白名單成員（Issue #1 指派名單唯一來源）", () => {
    const members = [mkMember(1, true), mkMember(2, false), mkMember(3, true)];
    expect(filterAssignableMembers(members).map((m) => m.id)).toEqual([1, 3]);
  });

  it("無白名單成員時回傳空陣列", () => {
    expect(filterAssignableMembers([mkMember(9, false)])).toEqual([]);
  });
});

describe("filterVisibleProjects / isProjectVisible", () => {
  const projects: TenderProject[] = [
    proj({ id: "own-2", stage: "preparing", ownerId: 2 }),
    proj({ id: "sub-2", stage: "won", subtasks: [mkSub(2)] }),
    proj({ id: "other", stage: "watching", ownerId: 1, subtasks: [mkSub(5)] }),
  ];
  const noFilter: BoardView = {
    mineOnly: false,
    memberFilter: null,
    stageFilter: null,
  };

  it("無過濾時全部可見", () => {
    expect(filterVisibleProjects(projects, noFilter, null)).toHaveLength(3);
  });

  it("stageFilter 只留符合階段者", () => {
    const view: BoardView = { ...noFilter, stageFilter: "won" };
    expect(
      filterVisibleProjects(projects, view, null).map((p) => p.id),
    ).toEqual(["sub-2"]);
  });

  it("memberFilter 認 owner 或任一子任務指派者", () => {
    const view: BoardView = { ...noFilter, memberFilter: 2 };
    expect(
      filterVisibleProjects(projects, view, null).map((p) => p.id),
    ).toEqual(["own-2", "sub-2"]);
  });

  it("mineOnly 在 currentMemberId 為 null 時全部隱藏", () => {
    const view: BoardView = { ...noFilter, mineOnly: true };
    expect(filterVisibleProjects(projects, view, null)).toEqual([]);
  });

  it("mineOnly 認當前帳號為 owner 或子任務指派者", () => {
    const view: BoardView = { ...noFilter, mineOnly: true };
    expect(filterVisibleProjects(projects, view, 2).map((p) => p.id)).toEqual([
      "own-2",
      "sub-2",
    ]);
  });

  it("stageFilter 與 memberFilter 同時生效（交集）", () => {
    const view: BoardView = {
      ...noFilter,
      memberFilter: 2,
      stageFilter: "won",
    };
    expect(isProjectVisible(projects[0], view, null)).toBe(false); // own-2 階段不符
    expect(isProjectVisible(projects[1], view, null)).toBe(true); // sub-2 階段+成員皆符
  });
});
