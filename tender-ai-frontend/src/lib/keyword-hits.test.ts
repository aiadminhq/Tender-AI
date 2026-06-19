import { describe, it, expect } from "vitest";
import { keywordHits, BUILTIN_KEYWORDS } from "@/lib/keyword-hits";

const T = (title: string, org = "") => ({ title, org });

describe("keywordHits", () => {
  it("命中內建詞庫", () => {
    expect(keywordHits(T("某國小教室整修工程"), [])).toEqual(
      expect.arrayContaining(["整修", "教室"]),
    );
  });

  it("命中 focus 規則並與內建合併去重", () => {
    const hits = keywordHits(T("醫院室內裝修"), ["醫院", "室內"]);
    expect(hits).toContain("醫院");
    expect(hits).toContain("室內");
    expect(hits).toContain("裝修");
    expect(new Set(hits).size).toBe(hits.length); // 無重複
  });

  it("比對 org 欄位", () => {
    expect(keywordHits(T("採購案", "臺北市政府教室管理處"), [])).toContain(
      "教室",
    );
  });

  it("未命中回空陣列", () => {
    expect(keywordHits(T("純道路鋪設"), ["醫院"])).toEqual([]);
  });

  it("忽略空字串規則", () => {
    expect(keywordHits(T("室內裝修"), ["", "  "])).not.toContain("");
  });

  it("匯出內建詞庫含關鍵詞", () => {
    expect(BUILTIN_KEYWORDS).toContain("裝修");
    expect(BUILTIN_KEYWORDS).toContain("防水");
  });
});
