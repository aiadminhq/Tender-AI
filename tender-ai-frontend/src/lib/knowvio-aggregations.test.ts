import { describe, it, expect } from "vitest";
import type { ActivityItem, ActivityKind, KanbanCard } from "@/types/domain";
import {
  donutSegmentsFromActivity,
  statusByTenderId,
  tenderStatusKind,
  trendDeltaPct,
} from "./knowvio-aggregations";

function act(kind: ActivityKind): ActivityItem {
  return {
    id: `a-${kind}-${Math.random()}`,
    at: "2026-06-27T00:00:00Z",
    userId: "u1",
    kind,
  };
}

function card(
  tenderId: string | undefined,
  status: KanbanCard["status"],
): KanbanCard {
  return {
    id: `c-${tenderId ?? "none"}-${status}`,
    tenderId,
    title: "t",
    status,
  };
}

describe("donutSegmentsFromActivity", () => {
  it("空陣列回傳 4 桶皆 0、pct 皆 0", () => {
    const segs = donutSegmentsFromActivity([]);
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => s.count === 0 && s.pct === 0)).toBe(true);
    expect(segs.map((s) => s.key)).toEqual(["view", "rate", "board", "other"]);
  });

  it("依 kind 分桶並計數", () => {
    const segs = donutSegmentsFromActivity([
      act("comment"),
      act("accept"),
      act("judge"),
      act("move"),
      act("skip"),
    ]);
    const by = Object.fromEntries(segs.map((s) => [s.key, s.count]));
    expect(by.view).toBe(1); // comment
    expect(by.rate).toBe(2); // accept + judge
    expect(by.board).toBe(1); // move
    expect(by.other).toBe(1); // skip
  });

  it("pct 經最大餘數法後總和恰為 100", () => {
    // 3 件均分 → 33.33 each → largest remainder 補到 100
    const segs = donutSegmentsFromActivity([
      act("comment"),
      act("accept"),
      act("move"),
    ]);
    expect(segs.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });

  it("非整除分佈 pct 總和仍為 100", () => {
    const segs = donutSegmentsFromActivity([
      act("comment"),
      act("comment"),
      act("accept"),
      act("move"),
      act("move"),
      act("skip"),
      act("rule"),
    ]);
    expect(segs.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });
});

describe("statusByTenderId", () => {
  it("略過無 tenderId 的卡片", () => {
    const map = statusByTenderId([
      card(undefined, "doing"),
      card("T1", "todo"),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("T1")).toBe("notStarted");
  });

  it("同 tenderId 取最進階狀態（done>review>doing>todo）", () => {
    const map = statusByTenderId([
      card("T1", "todo"),
      card("T1", "done"),
      card("T1", "doing"),
    ]);
    expect(map.get("T1")).toBe("pending"); // done → pending
  });

  it("doing/review 映射為 inProgress", () => {
    expect(statusByTenderId([card("T1", "doing")]).get("T1")).toBe(
      "inProgress",
    );
    expect(statusByTenderId([card("T2", "review")]).get("T2")).toBe(
      "inProgress",
    );
  });
});

describe("tenderStatusKind", () => {
  it("查無對應卡片回 notStarted", () => {
    const map = statusByTenderId([card("T1", "doing")]);
    expect(tenderStatusKind(map, "T1")).toBe("inProgress");
    expect(tenderStatusKind(map, "UNKNOWN")).toBe("notStarted");
  });
});

describe("trendDeltaPct", () => {
  it("正成長帶 + 號", () => {
    expect(trendDeltaPct([3, 5, 2, 6, 4, 8, 14])).toBe("+75%");
  });

  it("負成長帶 - 號", () => {
    expect(trendDeltaPct([10, 5])).toBe("-50%");
  });

  it("長度<2 回 null", () => {
    expect(trendDeltaPct([5])).toBeNull();
    expect(trendDeltaPct([])).toBeNull();
  });

  it("前值為 0（無真實基準）回 null", () => {
    expect(trendDeltaPct([0, 5])).toBeNull();
  });
});
