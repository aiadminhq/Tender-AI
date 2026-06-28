import { describe, it, expect } from "vitest";
import { serializeFilter, parseFilter, NORTH_CITIES } from "@/lib/url-filter";
import type { FilterState } from "@/types/domain";

const DEFAULT: FilterState = {
  query: "",
  sources: [],
  tiers: [],
  minBudget: null,
  maxBudget: null,
  focusOnly: false,
  hideExcluded: true,
  sort: "score",
  sortDir: "asc",
  categories: [],
  orgKeyword: "",
  deadlineFrom: null,
  deadlineTo: null,
  tagFilter: [],
  northOnly: false,
  newToday: false,
};

describe("url-filter", () => {
  it("預設值序列化為空字串", () => {
    expect(serializeFilter(DEFAULT)).toBe("");
  });

  it("往返保真（含各型別欄位）", () => {
    const f: FilterState = {
      ...DEFAULT,
      query: "教室 整修",
      sources: ["PCC", "TMU"],
      tiers: ["high"],
      minBudget: 1_000_000,
      maxBudget: 8_000_000,
      focusOnly: true,
      hideExcluded: false,
      sort: "feasibility",
      categories: ["works", "goods"],
      orgKeyword: "臺北",
      deadlineFrom: "2026-06-01",
      deadlineTo: "2026-07-01",
      tagFilter: ["室內", "防水"],
      northOnly: true,
      newToday: true,
    };
    const round = parseFilter("?" + serializeFilter(f), DEFAULT);
    expect(round).toEqual(f);
  });

  it("解析空字串回 base", () => {
    expect(parseFilter("", DEFAULT)).toEqual(DEFAULT);
  });

  it("忽略未知 key、容錯壞值", () => {
    const r = parseFilter("?bogus=x&maxBudget=notnum&sort=weird", DEFAULT);
    expect(r.minBudget).toBeNull();
    expect(r.maxBudget).toBeNull();
    expect(r.sort).toBe("score");
  });

  it("匯出北部城市清單", () => {
    expect(NORTH_CITIES).toContain("台北");
    expect(NORTH_CITIES).toContain("桃園");
  });
});
