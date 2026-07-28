import { describe, expect, it } from "vitest";
import { sortFocusItems } from "./focus-sort";

type Item = {
  id: string;
  budget?: number | null;
  deadline?: string;
  feasibility: number;
};

const items: Item[] = [
  {
    id: "near",
    budget: 100,
    deadline: "2026-08-01T00:00:00Z",
    feasibility: 40,
  },
  {
    id: "far",
    budget: 300,
    deadline: "2026-09-01T00:00:00Z",
    feasibility: 80,
  },
  { id: "unknown", budget: null, deadline: "", feasibility: 60 },
];

const scoreOf = (item: Item) => item.feasibility;

describe("sortFocusItems", () => {
  it("截止日降冪時最遠截止日在前，未知日期固定在最後", () => {
    expect(
      sortFocusItems(items, "deadline", "desc", scoreOf).map((x) => x.id),
    ).toEqual(["far", "near", "unknown"]);
  });

  it("截止日升冪時最近截止日在前，未知日期仍固定在最後", () => {
    expect(
      sortFocusItems(items, "deadline", "asc", scoreOf).map((x) => x.id),
    ).toEqual(["near", "far", "unknown"]);
  });

  it("可行性與預算皆支援升降冪", () => {
    expect(
      sortFocusItems(items, "feasibility", "asc", scoreOf).map((x) => x.id),
    ).toEqual(["near", "unknown", "far"]);
    expect(
      sortFocusItems(items, "budget", "desc", scoreOf).map((x) => x.id),
    ).toEqual(["far", "near", "unknown"]);
  });
});
