// 小助手回答的 Markdown 渲染：react-markdown + remark-gfm（支援標題／清單／表格／程式碼／
// 連結／粗斜體）。元件對映全部套用本專案 house style（Noto Sans TC、13px 內文、16px 圓角、
// 單色面 + 單一 signal 強調），不引官方 MarkdownText 樣式。表格放進可橫向捲動的容器，
// 避免撐破浮窗寬度。串流期間 text 會逐步增長，react-markdown 會就地重渲染、語意安全。
import { Children, memo, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { requestAssistant } from "@/lib/assistant-bus";
import { cn } from "@/lib/utils";
import { makeTenderLinkPlugin, type TenderRef } from "./rich-text-links";

const TOOL_CTA: Record<string, { label: string; prompt: string }> = {
  get_tender: {
    label: "查標案完整資料",
    prompt: "請幫我查指定標案的完整資料，包含機關、預算、截止日、資格條件與來源連結。",
  },
  explain_tender: {
    label: "看標案詳情與理由",
    prompt: "請幫我說明指定標案的可行度理由、資格條件、預算分類與相似決策。",
  },
  "/tender-daily": {
    label: "更新每日標案",
    prompt: "請協助檢查每日標案更新狀態，並整理今天可用的新標案與抓取限制。",
  },
};

function inlineText(children: ReactNode): string {
  return Children.toArray(children).join("").trim();
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
  a: ({ href, className, children }) => {
    const isSourceButton =
      typeof className === "string" && className.includes("assistant-source-link");
    if (isSourceButton) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100"
        >
          {children}
        </a>
      );
    }
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
    const raw = inlineText(children);
    const cta = TOOL_CTA[raw];
    if (cta) {
      return (
        <button
          type="button"
          onClick={() => requestAssistant(cta.prompt)}
          className="inline-flex items-center rounded-lg border border-orange-200 bg-orange-50 px-2 py-0.5 text-[12px] font-semibold text-orange-700 transition-colors hover:border-orange-300 hover:bg-orange-100"
          title={raw}
        >
          {cta.label}
        </button>
      );
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
    <th className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ className, children }) => (
    <td
      className={cn(
        "border-b border-border/60 px-2.5 py-1.5 align-top text-foreground/90",
        typeof className === "string" &&
          className.includes("assistant-source-cell") &&
          "whitespace-nowrap text-right",
      )}
    >
      {children}
    </td>
  ),
};

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
