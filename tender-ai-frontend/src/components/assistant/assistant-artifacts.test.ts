import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantArtifacts } from "./assistant-artifacts";
import type { AssistantArtifact } from "./assistant-artifact-types";

describe("AssistantArtifacts", () => {
  it("renders chart artifact shell and legend", () => {
    const artifacts: AssistantArtifact[] = [
      {
        type: "chart",
        id: "weekly",
        title: "近 7 日標案量",
        caption: "依每日新增件數統計",
        chartType: "bar",
        xKey: "day",
        series: [{ key: "count", label: "件數" }],
        rows: [
          { day: "6/21", count: 12 },
          { day: "6/22", count: 18 },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(AssistantArtifacts, { artifacts }),
    );

    expect(html).toContain("近 7 日標案量");
    expect(html).toContain("依每日新增件數統計");
    expect(html).toContain("件數");
    expect(html).toContain("data-slot=\"chart\"");
  });

  it("renders save/share action artifact controls", () => {
    const artifacts: AssistantArtifact[] = [
      {
        type: "actions",
        id: "share-ranking",
        title: "分享本次排序",
        caption: "含 2 筆標案",
        tenderIds: [5, 9],
        actions: ["save", "share", "copy"],
        payload: { source: "assistant" },
      },
    ];

    const html = renderToStaticMarkup(
      createElement(AssistantArtifacts, { artifacts }),
    );

    expect(html).toContain("分享本次排序");
    expect(html).toContain("含 2 筆標案");
    expect(html).toContain("收藏標案");
    expect(html).toContain("分享");
    expect(html).toContain("複製");
  });
});
