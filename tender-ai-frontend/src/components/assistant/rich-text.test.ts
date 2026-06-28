import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
