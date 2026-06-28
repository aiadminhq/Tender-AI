import { describe, expect, it } from "vitest";
import { adaptC1Artifact } from "./assistant-artifact-adapter";

describe("adaptC1Artifact", () => {
  it("normalizes C1 table payload with snake_case fields", () => {
    expect(
      adaptC1Artifact({
        kind: "table",
        artifact_id: "ranked-tenders",
        title: "標案排序",
        description: "依可行度排序",
        columns: [
          { key: "name", label: "標案" },
          { key: "score", label: "分數", align: "right" },
        ],
        data: [{ name: "資訊系統", score: 91 }],
      }),
    ).toEqual({
      type: "table",
      id: "ranked-tenders",
      title: "標案排序",
      caption: "依可行度排序",
      columns: [
        { key: "name", label: "標案" },
        { key: "score", label: "分數", align: "right" },
      ],
      rows: [{ name: "資訊系統", score: 91 }],
    });
  });

  it("normalizes C1 chart payload with chart_type and x_key", () => {
    expect(
      adaptC1Artifact({
        kind: "chart",
        artifact_id: "weekly",
        chart_type: "line",
        x_key: "day",
        series: [{ key: "count", label: "件數" }],
        data: [{ day: "6/22", count: 18 }],
      }),
    ).toEqual({
      type: "chart",
      id: "weekly",
      title: null,
      caption: null,
      chartType: "line",
      xKey: "day",
      series: [{ key: "count", label: "件數" }],
      rows: [{ day: "6/22", count: 18 }],
    });
  });

  it("normalizes action payload and rejects invalid artifacts", () => {
    expect(
      adaptC1Artifact({
        kind: "action",
        artifact_id: "save-share",
        tender_ids: ["5", 9, "bad"],
        action_ids: ["save", "share", "unknown"],
        data: { source: "c1" },
      }),
    ).toEqual({
      type: "actions",
      id: "save-share",
      title: null,
      caption: null,
      tenderIds: [5, 9],
      payload: { source: "c1" },
      actions: ["save", "share"],
    });

    expect(adaptC1Artifact({ kind: "chart", series: [] })).toBeNull();
    expect(adaptC1Artifact(null)).toBeNull();
  });
});
