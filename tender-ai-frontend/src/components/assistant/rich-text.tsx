// 小助手回答的 Markdown 渲染：react-markdown + remark-gfm（支援標題／清單／表格／程式碼／
// 連結／粗斜體）。元件對映全部套用本專案 house style（Noto Sans TC、13px 內文、16px 圓角、
// 單色面 + 單一 signal 強調），不引官方 MarkdownText 樣式。表格放進可橫向捲動的容器，
// 避免撐破浮窗寬度。串流期間 text 會逐步增長，react-markdown 會就地重渲染、語意安全。
import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// 該則回答已「引用」到的標案（id → 標題）。只有清單內的 #id 才會被連結，
// 避免大腦隨手寫出的編號變成死連結。
export interface TenderRef {
  id: number;
  title: string;
}

const COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="text-[13px] leading-relaxed text-foreground/90">{children}</p>
  ),
  h1: ({ children }) => (
    <h2 className="mt-1 text-[14px] font-semibold text-foreground">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-1 text-[13px] font-semibold text-foreground">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </h4>
  ),
  ul: ({ children }) => (
    <ul className="ml-1 list-none space-y-1.5 text-[13px] leading-relaxed text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="ml-1 list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-foreground/90 marker:text-ink-dim marker:tnum">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="relative pl-4 [ol>&]:pl-0">
      <span className="absolute left-0 top-0 text-ink-dim [ol>&]:hidden">
        •
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  ),
  a: ({ href, children }) => {
    // 內部標案連結（rehype 注入的 /tenders/<id>）走 SPA 同分頁導航；
    // 外部連結維持新分頁開啟。
    if (href && href.startsWith("/")) {
      return (
        <Link
          to={href}
          className="font-medium text-signal underline decoration-signal/30 underline-offset-2 hover:decoration-signal"
        >
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-signal/40 pl-3 text-[13px] leading-relaxed text-ink-muted">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return <code className="font-mono text-[12px]">{children}</code>;
    }
    return (
      <code className="rounded bg-accent px-1 py-0.5 font-mono text-[12px] text-foreground">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-xl border border-border bg-canvas px-3 py-2.5 text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  // GFM 表格：包一層 overflow-x-auto，窄浮窗也不會被撐破。
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-accent/60 text-foreground">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border/60 px-2.5 py-1.5 align-top text-foreground/90">
      {children}
    </td>
  ),
};

// 把一段純文字依「#<id>（＋緊跟的標題）」切成 text/anchor 的 hast 節點序列。
// 只連結 byId 內（該則已引用）的 id；若 #id 後面緊接著該標案的標題（容忍中間空白），
// 連結文字一併涵蓋標題，整段「#98 公共藝術拆除改善工程」成為單一可點連結。
function splitTenderRefs(value: string, byId: Map<string, string>): unknown[] {
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
function makeTenderLinkPlugin(refs: TenderRef[]) {
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

function RichTextImpl({
  text,
  className,
  tenderRefs,
}: {
  text: string;
  className?: string;
  tenderRefs?: TenderRef[];
}) {
  const rehypePlugins = useMemo(
    () =>
      tenderRefs && tenderRefs.length ? [makeTenderLinkPlugin(tenderRefs)] : [],
    [tenderRefs],
  );
  return (
    <div className={cn("space-y-2.5", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
}

// 串流期間同一則訊息會以遞增的 text 反覆重渲染；memo 避免 sibling 連帶重算。
export const RichText = memo(RichTextImpl);
