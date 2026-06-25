import { describe, it, expect } from "vitest";
import {
  STAGE_FROM_STATUS,
  cardsToProjects,
  filterAssignableMembers,
  mergeAccountsIntoMembers,
  isProjectVisible,
  filterVisibleProjects,
  resolveTender,
} from "./board-logic";
import { TENDERS } from "@/data/tenders";
import { authDisplay, type AccountRow } from "@/lib/auth-api";
import type {
  BoardView,
  KanbanCard,
  Member,
  Subtask,
  Tender,
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

describe("mergeAccountsIntoMembers（白名單 hydration 合併＋prune）", () => {
  const mkRow = (
    id: number,
    email: string | null,
    over: Partial<AccountRow> = {},
  ): AccountRow => ({
    id,
    name: email ? email.split("@")[0] : `u${id}`,
    email,
    role: "member",
    isAdmin: false,
    whitelistActive: true,
    consentShared: false,
    ...over,
  });

  it("剔除『種子來源（正 id）但後端已不存在』的殘留假帳號（復活 bug 的回歸守衛）", () => {
    const prev = [mkMember(1, true), mkMember(2, true)]; // m1@ 後端有、m2@ 後端無
    const out = mergeAccountsIntoMembers(prev, [mkRow(101, "m1@hqdesign.tw")]);
    const emails = out.map((m) => m.email);
    expect(emails).toContain("m1@hqdesign.tw");
    expect(emails).not.toContain("m2@hqdesign.tw"); // 不復活
    expect(out).toHaveLength(1);
  });

  it("保留本地新增、尚未落地後端者（負 id），即使後端沒有它", () => {
    const prev = [mkMember(-1, false)]; // 剛由 UI 新增、未開通白名單
    const out = mergeAccountsIntoMembers(prev, [
      mkRow(101, "other@hqdesign.tw"),
    ]);
    const local = out.find((m) => m.id === -1);
    expect(local?.email).toBe("m-1@hqdesign.tw");
    expect(out.map((m) => m.email)).toContain("other@hqdesign.tw");
  });

  it("後端列以真實 id / whitelist / consent 覆寫本地同 email 種子，並重算頭像", () => {
    const prev = [mkMember(1, false)]; // 本地種子 id=1, wl=false
    const rows = [
      mkRow(777, "m1@hqdesign.tw", {
        name: "Real One",
        role: "admin",
        isAdmin: true,
        whitelistActive: true,
        consentShared: true,
      }),
    ];
    const out = mergeAccountsIntoMembers(prev, rows);
    expect(out).toHaveLength(1);
    const m = out[0];
    expect(m.id).toBe(777); // 真實 id 覆寫
    expect(m.name).toBe("Real One");
    expect(m.role).toBe("admin");
    expect(m.whitelistActive).toBe(true);
    expect(m.consentShared).toBe(true);
    const d = authDisplay({ name: "Real One", email: "m1@hqdesign.tw" });
    expect(m.initials).toBe(d.initials); // 頭像由後端 name/email 重算
    expect(m.color).toBe(d.color);
  });

  it("後端新帳號（本地沒有）會被併入名單", () => {
    const out = mergeAccountsIntoMembers([], [mkRow(5, "new@hqdesign.tw")]);
    expect(out.map((m) => m.email)).toEqual(["new@hqdesign.tw"]);
  });

  it("email 比對不分大小寫：同 email 不重複、且被後端覆寫（不誤剔）", () => {
    const prev: Member[] = [
      { ...mkMember(1, false), email: "Alex@HQDesign.TW" },
    ];
    const out = mergeAccountsIntoMembers(prev, [
      mkRow(9, "alex@hqdesign.tw", { name: "Alex" }),
    ]);
    expect(out).toHaveLength(1); // 不因大小寫而重複
    expect(out[0].id).toBe(9); // 後端覆寫
  });

  it("無 email 的成員原樣保留；後端 email=null（系統佔位）不納入合併", () => {
    const prev: Member[] = [{ ...mkMember(1, true), email: null }];
    const out = mergeAccountsIntoMembers(prev, [
      mkRow(1, null, { name: "default" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBeNull();
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

describe("resolveTender（Issue #2 點擊開抽屜的 id 解析）", () => {
  // 模擬「連線後」：tenders 被換成後端標案（id 為數字字串），不含 mock 種子 id。
  const live: Tender[] = [{ ...TENDERS[0], id: "3556" }];

  it("優先回傳目前清單（live）命中者", () => {
    expect(resolveTender("3556", live, TENDERS)?.id).toBe("3556");
  });

  it("live 查無時回退 mock 種子清單 — 連線時種子卡 t-001 仍能開（本次回歸根因）", () => {
    // 種子專案 tenderId 為 t-001；live 清單沒有它，舊版 tenders.find 會回 undefined → 抽屜不開。
    expect(resolveTender("t-001", live, TENDERS)?.id).toBe("t-001");
  });

  it("id 為 null 或兩邊皆無 → null", () => {
    expect(resolveTender(null, live, TENDERS)).toBeNull();
    expect(resolveTender("does-not-exist", live, TENDERS)).toBeNull();
  });
});
