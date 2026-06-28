export interface TenderRef {
  id: number;
  title: string;
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

// 自寫的 rehype 轉換：在 hast 上把文字節點中的標案編號改寫成內部連結節點。
// 跳過 a/code/pre 內的文字（避免污染既有連結與程式碼）。無依賴、串流期間反覆套用安全。
export function makeTenderLinkPlugin(refs: TenderRef[]) {
  const byId = new Map(refs.map((r) => [String(r.id), r.title]));
  const SKIP = new Set(["a", "code", "pre"]);
  const walk = (node: { tagName?: string; children?: unknown[] }) => {
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
        out.push(...splitTenderRefs(child.value, byId));
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
