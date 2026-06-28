export interface TenderRef {
  id?: number | null;
  title: string;
  url?: string | null;
  source?: string | null;
}

// 把一段純文字依「#<id>（＋緊跟的標題）」切成 text/anchor 的 hast 節點序列。
// 只連結 byId 內（該則已引用）的 id；若 #id 後面緊接著該標案的標題（容忍中間空白），
// 連結文字一併涵蓋標題，整段「#98 公共藝術拆除改善工程」成為單一可點連結。
export function splitTenderRefs(
  value: string,
  byId: Map<string, string>,
): unknown[] {
  const nodes: unknown[] = [];
  const re = /#(\d{1,8})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const id = m[1];
    const title = byId.get(id);
    if (title === undefined) continue; // 未引用 → 不連結
    const start = m.index;
    let end = start + m[0].length;
    let linkText = m[0];
    const rest = value.slice(end);
    const lead = rest.match(/^\s*/)?.[0] ?? "";
    if (title && rest.slice(lead.length).startsWith(title)) {
      end += lead.length + title.length;
      linkText = value.slice(start, end);
    }
    if (start > last)
      nodes.push({ type: "text", value: value.slice(last, start) });
    nodes.push({
      type: "element",
      tagName: "a",
      properties: { href: `/tenders/${id}` },
      children: [{ type: "text", value: linkText }],
    });
    last = end;
    re.lastIndex = end; // 跳過已併入標題的範圍，避免重複比對
  }
  if (last < value.length)
    nodes.push({ type: "text", value: value.slice(last) });
  return nodes.length ? nodes : [{ type: "text", value }];
}

function textNode(value: string) {
  return { type: "text", value };
}

function tenderRefAnchor(ref: TenderRef, value: string) {
  const href = ref.id != null ? `/tenders/${ref.id}` : ref.url;
  if (!href) return textNode(value);
  return {
    type: "element",
    tagName: "a",
    properties: {
      href,
      ...(ref.id == null ? { target: "_blank", rel: "noreferrer" } : {}),
    },
    children: [textNode(value)],
  };
}

function nodeText(node: { value?: string; children?: unknown[] }): string {
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children
    .map((child) =>
      nodeText(
        child as {
          value?: string;
          children?: unknown[];
        },
      ),
    )
    .join("");
}

function splitTenderTitleRefs(value: string, refs: TenderRef[]): unknown[] {
  const matches = refs
    .filter((ref) => ref.title.trim())
    .sort((a, b) => b.title.length - a.title.length);
  const nodes: unknown[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const match = matches
      .map((ref) => ({ ref, index: value.indexOf(ref.title, cursor) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index || b.ref.title.length - a.ref.title.length)[0];

    if (!match) break;
    if (match.index > cursor) {
      nodes.push(textNode(value.slice(cursor, match.index)));
    }
    nodes.push(tenderRefAnchor(match.ref, match.ref.title));
    cursor = match.index + match.ref.title.length;
  }

  if (cursor < value.length) nodes.push(textNode(value.slice(cursor)));
  return nodes.length ? nodes : [textNode(value)];
}

function matchingTenderRef(text: string, refs: TenderRef[]): TenderRef | null {
  const compact = text.replace(/\s+/g, "");
  return (
    refs.find((ref) => {
      const title = ref.title.replace(/\s+/g, "");
      return title.length > 0 && compact.includes(title);
    }) ?? null
  );
}

function sourceLabel(ref: TenderRef): string {
  return ref.source?.toUpperCase?.() === "PCC" ? "PCC" : "來源";
}

function sourceButton(ref: TenderRef) {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href: ref.url,
      target: "_blank",
      rel: "noreferrer",
      className: ["assistant-source-link"],
    },
    children: [textNode(sourceLabel(ref))],
  };
}

function appendTableSourceColumn(
  node: { tagName?: string; children?: unknown[] },
  refs: TenderRef[],
) {
  if (node.tagName !== "table" || !Array.isArray(node.children)) return;

  const rows: Array<{
    row: { tagName?: string; children?: unknown[] };
    ref: TenderRef | null;
  }> = [];
  for (const section of node.children as Array<{
    tagName?: string;
    children?: unknown[];
  }>) {
    if (section.tagName !== "tbody" || !Array.isArray(section.children)) continue;
    for (const row of section.children as Array<{
      tagName?: string;
      children?: unknown[];
    }>) {
      if (row.tagName !== "tr" || !Array.isArray(row.children)) continue;
      rows.push({ row, ref: matchingTenderRef(nodeText(row), refs) });
    }
  }

  const shouldAddHeader = rows.some((item) => item.ref?.url);
  if (!shouldAddHeader) return;

  for (const { row, ref } of rows) {
    row.children?.push({
      type: "element",
      tagName: "td",
      properties: { className: ["assistant-source-cell"] },
      children: ref?.url ? [sourceButton(ref)] : [],
    });
  }

  for (const section of node.children as Array<{
    tagName?: string;
    children?: unknown[];
  }>) {
    if (section.tagName !== "thead" || !Array.isArray(section.children)) continue;
    for (const row of section.children as Array<{
      tagName?: string;
      children?: unknown[];
    }>) {
      if (row.tagName !== "tr" || !Array.isArray(row.children)) continue;
      row.children.push({
        type: "element",
        tagName: "th",
        properties: { className: ["assistant-source-header"] },
        children: [textNode("來源")],
      });
    }
  }
}

// 自寫的 rehype 轉換：在 hast 上把文字節點中的標案編號改寫成內部連結節點。
// 跳過 a/code/pre 內的文字（避免污染既有連結與程式碼）。無依賴、串流期間反覆套用安全。
export function makeTenderLinkPlugin(refs: TenderRef[]) {
  const byId = new Map(
    refs
      .filter((r) => r.id != null)
      .map((r) => [String(r.id), r.title]),
  );
  const SKIP = new Set(["a", "code", "pre"]);
  const walk = (node: { tagName?: string; children?: unknown[] }) => {
    appendTableSourceColumn(node, refs);
    const children = node.children;
    if (!Array.isArray(children)) return;
    const out: unknown[] = [];
    for (const child of children as Array<{
      type?: string;
      tagName?: string;
      value?: string;
      children?: unknown[];
    }>) {
      if (child.type === "element") {
        if (!SKIP.has(child.tagName ?? "")) walk(child);
        out.push(child);
      } else if (child.type === "text" && typeof child.value === "string") {
        const withIds = splitTenderRefs(child.value, byId);
        for (const part of withIds as Array<{
          type?: string;
          value?: string;
        }>) {
          if (part.type === "text" && typeof part.value === "string") {
            out.push(...splitTenderTitleRefs(part.value, refs));
          } else {
            out.push(part);
          }
        }
      } else {
        out.push(child);
      }
    }
    node.children = out;
  };
  return () => (tree: { children?: unknown[] }) => {
    if (byId.size === 0) return;
    walk(tree);
  };
}
