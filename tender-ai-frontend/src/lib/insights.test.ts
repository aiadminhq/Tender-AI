import { describe, it, expect } from "vitest";
import type { Category, SourceKey, Tender } from "@/types/domain";
import {
  aggregateByCategory,
  aggregateBySource,
  totalBudget,
  budgetBeforeAfter,
} from "@/lib/insights";

// 最小 Tender fixture：彙總只讀 category／source／budget，其餘填合法佔位值。
function makeTender(
  id: string,
  category: Category,
  source: SourceKey,
  budget: number,
): Tender {
  return {
    id,
    title: `案 ${id}`,
    org: "測試機關",
    source,
    budget,
    deadline: "2026-07-01",
    publishedAt: "2026-06-21",
    tier: "mid",
    score: 20,
    feasibility: 50,
    supplierCoverage: 50,
    category,
    tags: [],
  };
}

const SAMPLE: Tender[] = [
  makeTender("t1", "works", "PCC", 100),
  makeTender("t2", "works", "TMU", 300),
  makeTender("t3", "goods", "PCC", 50),
  makeTender("t4", "services", "TPC", 0),
];

describe("aggregateByCategory", () => {
  it("固定回傳 works／goods／services 三段且維持順序", () => {
    const rows = aggregateByCategory(SAMPLE);
    expect(rows.map((r) => r.key)).toEqual(["works", "goods", "services"]);
  });

  it("件數、金額與各自佔比正確", () => {
    const rows = aggregateByCategory(SAMPLE);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.works.count).toBe(2);
    expect(byKey.works.budget).toBe(400);
    expect(byKey.works.countFrac).toBeCloseTo(0.5, 6);
    expect(byKey.works.budgetFrac).toBeCloseTo(400 / 450, 6);
    expect(byKey.goods.count).toBe(1);
    expect(byKey.goods.budget).toBe(50);
    // 金額為 0 的類別仍回傳一列（佔比 0），不靜默消失。
    expect(byKey.services.count).toBe(1);
    expect(byKey.services.budget).toBe(0);
    expect(byKey.services.budgetFrac).toBe(0);
  });

  it("空輸入回三段全 0，佔比不除以零", () => {
    const rows = aggregateByCategory([]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.count === 0 && r.countFrac === 0)).toBe(true);
    expect(rows.every((r) => r.budgetFrac === 0)).toBe(true);
  });
});

describe("aggregateBySource", () => {
  it("僅含實際出現的來源，依金額由大到小排序", () => {
    const rows = aggregateBySource(SAMPLE);
    // 出現 PCC(150)／TMU(300)／TPC(0)；NPC 未出現不列。
    expect(rows.map((r) => r.key)).toEqual(["TMU", "PCC", "TPC"]);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.PCC.count).toBe(2);
    expect(byKey.PCC.budget).toBe(150);
    expect(byKey.TMU.budget).toBe(300);
  });

  it("空輸入回空陣列", () => {
    expect(aggregateBySource([])).toEqual([]);
  });
});

describe("totalBudget", () => {
  it("加總所有金額", () => {
    expect(totalBudget(SAMPLE)).toBe(450);
    expect(totalBudget([])).toBe(0);
  });
});

describe("budgetBeforeAfter", () => {
  it("件數／金額保留比例與增減量", () => {
    const filtered = SAMPLE.filter((t) => t.category === "works");
    const r = budgetBeforeAfter(SAMPLE, filtered);
    expect(r.beforeCount).toBe(4);
    expect(r.afterCount).toBe(2);
    expect(r.beforeBudget).toBe(450);
    expect(r.afterBudget).toBe(400);
    expect(r.delta).toBe(-50);
    expect(r.budgetRetainedPct).toBeCloseTo((400 / 450) * 100, 6);
    expect(r.countRetainedPct).toBe(50);
  });

  it("基底為空時保留比例回 0，不除以零", () => {
    const r = budgetBeforeAfter([], []);
    expect(r.budgetRetainedPct).toBe(0);
    expect(r.countRetainedPct).toBe(0);
  });
});
