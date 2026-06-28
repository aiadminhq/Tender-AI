import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RichText } from "./rich-text";
import { makeTenderLinkPlugin, splitTenderRefs } from "./rich-text-links";

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

describe("RichText", () => {
  it("renders GFM tables inside the assistant table shell", () => {
    const html = renderToStaticMarkup(
      createElement(RichText, {
        text: "| 標案 | 分數 |\n| --- | ---: |\n| A | 91 |",
      }),
    );

    expect(html).toContain("<table");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("links tender titles in tables and adds a source action column", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(RichText, {
          text:
            "| 可行度 | 案名 | 機關 |\n" +
            "| --- | --- | --- |\n" +
            "| 99 | 綜合大樓空調系統汰換工程 | 衛福部基隆醫院 |",
          tenderRefs: [
            {
              id: 98,
              title: "綜合大樓空調系統汰換工程",
              url: "https://web.pcc.gov.tw/example",
              source: "PCC",
            },
          ],
        }),
      ),
    );

    expect(html).toContain("href=\"/tenders/98\"");
    expect(html).toContain("綜合大樓空調系統汰換工程");
    expect(html).toContain("href=\"https://web.pcc.gov.tw/example\"");
    expect(html).toContain(">PCC</a>");
  });

  it("uses source URL for tender titles that are not in the local DB yet", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(RichText, {
          text:
            "| 標案 | 機關 |\n" +
            "| --- | --- |\n" +
            "| 開刀房及 ICU 空調箱汰換 | 臺大醫院新竹分院 |",
          tenderRefs: [
            {
              id: null,
              title: "開刀房及 ICU 空調箱汰換",
              url: "https://web.pcc.gov.tw/tps/example",
              source: "PCC",
            },
          ],
        }),
      ),
    );

    expect(html).toContain("href=\"https://web.pcc.gov.tw/tps/example\"");
    expect(html).toContain("target=\"_blank\"");
    expect(html).not.toContain("href=\"/tenders/");
  });

  it("renders tool names as Chinese CTA buttons", () => {
    const html = renderToStaticMarkup(
      createElement(RichText, {
        text: "可用 `explain_tender` 來看完整理由。",
      }),
    );

    expect(html).toContain("看標案詳情與理由");
    expect(html).not.toContain(">explain_tender</code>");
  });
});

describe("splitTenderRefs", () => {
  it("links only cited tender ids and includes the immediate title", () => {
    const nodes = splitTenderRefs(
      "建議先看 #98 公共藝術拆除改善工程，再排除 #77。",
      new Map([["98", "公共藝術拆除改善工程"]]),
    ) as HastNode[];

    expect(nodes).toEqual([
      { type: "text", value: "建議先看 " },
      {
        type: "element",
        tagName: "a",
        properties: { href: "/tenders/98" },
        children: [{ type: "text", value: "#98 公共藝術拆除改善工程" }],
      },
      { type: "text", value: "，再排除 #77。" },
    ]);
  });
});

describe("makeTenderLinkPlugin", () => {
  it("skips existing links and code when rewriting tender ids", () => {
    const tree: HastNode = {
      children: [
        { type: "text", value: "比較 #5 資訊系統" },
        {
          type: "element",
          tagName: "code",
          children: [{ type: "text", value: "#5 資訊系統" }],
        },
        {
          type: "element",
          tagName: "a",
          properties: { href: "/already" },
          children: [{ type: "text", value: "#5 資訊系統" }],
        },
      ],
    };

    makeTenderLinkPlugin([{ id: 5, title: "資訊系統" }])()(tree);

    expect(tree.children?.[0]).toEqual({ type: "text", value: "比較 " });
    expect(tree.children?.[1]).toEqual({
      type: "element",
      tagName: "a",
      properties: { href: "/tenders/5" },
      children: [{ type: "text", value: "#5 資訊系統" }],
    });
    expect(tree.children?.[2]).toEqual({
      type: "element",
      tagName: "code",
      children: [{ type: "text", value: "#5 資訊系統" }],
    });
    expect(tree.children?.[3]).toEqual({
      type: "element",
      tagName: "a",
      properties: { href: "/already" },
      children: [{ type: "text", value: "#5 資訊系統" }],
    });
  });
});
