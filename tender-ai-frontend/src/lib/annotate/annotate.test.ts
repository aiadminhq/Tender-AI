import { describe, expect, it } from "vitest";
import { serializeAnnotations, severityLabel, typeLabel } from "./serialize";
import type { Annotation } from "./types";

// 註：selector.ts 依賴真實 DOM（Element/classList/tree walk），而本專案測試環境
// 刻意維持 node-only（無 jsdom/happy-dom），故 selector 的行為以瀏覽器實機驗證，
// 此處只單測「產生 CLI 回傳內容」的 serialize 純邏輯——最關鍵的正確性面。

describe("typeLabel / severityLabel", () => {
  it("回中文標籤", () => {
    expect(typeLabel("visual")).toBe("視覺");
    expect(typeLabel("copy")).toBe("文案");
    expect(severityLabel("blocker")).toBe("阻擋");
    expect(severityLabel("suggest")).toBe("建議");
  });
});

describe("serializeAnnotations", () => {
  const base: Annotation = {
    id: "1",
    route: "/tenders",
    selector: '[data-component="Button"]',
    componentGuess: "Button",
    textSnapshot: "送出",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    type: "visual",
    severity: "important",
    comment: "顏色太淡",
    createdAt: "2026-06-25T01:00:00.000Z",
  };

  it("空清單回傳佔位段落", () => {
    expect(serializeAnnotations([], "2026-06-25T00:00:00.000Z")).toContain(
      "（無標註）",
    );
  });

  it("依 route 分組並含關鍵欄位", () => {
    const md = serializeAnnotations(
      [base, { ...base, id: "2", route: "/rules", comment: "排版" }],
      "2026-06-25T02:00:00.000Z",
    );
    expect(md).toContain("跨 2 個頁面");
    expect(md).toContain("### 頁面：`/tenders`");
    expect(md).toContain("### 頁面：`/rules`");
    expect(md).toContain("顏色太淡");
    expect(md).toContain('`[data-component="Button"]`');
    expect(md).toContain("視覺");
  });

  it("空白建議顯示佔位字", () => {
    const md = serializeAnnotations(
      [{ ...base, comment: "   " }],
      "2026-06-25T02:00:00.000Z",
    );
    expect(md).toContain("（未填寫建議）");
  });

  it("組內依時間排序", () => {
    const md = serializeAnnotations(
      [
        {
          ...base,
          id: "b",
          comment: "後",
          createdAt: "2026-06-25T03:00:00.000Z",
        },
        {
          ...base,
          id: "a",
          comment: "前",
          createdAt: "2026-06-25T01:00:00.000Z",
        },
      ],
      "2026-06-25T04:00:00.000Z",
    );
    expect(md.indexOf("前")).toBeLessThan(md.indexOf("後"));
  });
});
