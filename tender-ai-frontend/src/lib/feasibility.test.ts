import { describe, it, expect } from "vitest";
import {
  computeFeasibility,
  type FeasLabels,
  type FeasRules,
} from "@/lib/feasibility";

const LABELS: FeasLabels = {
  works: "工程",
  goods: "財物",
  services: "勞務",
  budgetFit: "預算適配",
  deadlineFar: "截止充裕",
  deadlineMid: "截止適中",
  deadlineNear: "截止近",
  hardExcluded: "硬排除",
};
const RULES: FeasRules = { focus: [], hard: ["綜合營造業"] };

const base = {
  title: "某國小教室整修工程",
  org: "臺北市政府",
  category: "works" as const,
  budget: 8_000_000,
};

describe("computeFeasibility", () => {
  it("加總命中／類別／預算／截止", () => {
    // 命中 整修+教室+工程(內建?) → 至少 整修、教室 各+8；works +20；預算 +15；截止 30 天 +10
    const r = computeFeasibility(base, RULES, 30, LABELS);
    expect(r.score).toBeGreaterThan(40);
    expect(r.breakdown.some((b) => b.label === "整修" && b.delta === 8)).toBe(
      true,
    );
    expect(
      r.breakdown.some((b) => b.label === LABELS.works && b.delta === 20),
    ).toBe(true);
    expect(
      r.breakdown.some((b) => b.label === LABELS.budgetFit && b.delta === 15),
    ).toBe(true);
  });

  it("截止 <7 天扣分", () => {
    const r = computeFeasibility(base, RULES, 3, LABELS);
    expect(
      r.breakdown.some(
        (b) => b.label === LABELS.deadlineNear && b.delta === -8,
      ),
    ).toBe(true);
  });

  it("命中硬排除 → 分數壓到 30 以下", () => {
    const r = computeFeasibility(
      { ...base, title: "綜合營造業統包工程整修教室" },
      RULES,
      30,
      LABELS,
    );
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.breakdown.some((b) => b.label === LABELS.hardExcluded)).toBe(true);
  });

  it("clamp 不超過 100、不低於 0", () => {
    const high = computeFeasibility(
      { ...base, title: "整修教室室內裝修修繕防水拆除空間改善" },
      { focus: [], hard: [] },
      30,
      LABELS,
    );
    expect(high.score).toBeLessThanOrEqual(100);
    expect(high.score).toBeGreaterThanOrEqual(0);
  });

  it("類別 services 僅 +4", () => {
    const r = computeFeasibility(
      { ...base, category: "services" },
      { focus: [], hard: [] },
      30,
      LABELS,
    );
    expect(
      r.breakdown.some((b) => b.label === LABELS.services && b.delta === 4),
    ).toBe(true);
  });
});
