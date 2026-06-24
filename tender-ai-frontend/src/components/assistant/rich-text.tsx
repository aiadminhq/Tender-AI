// 小助手回答的 Markdown 渲染：react-markdown + remark-gfm（支援標題／清單／表格／程式碼／
// 連結／粗斜體）。元件對映全部套用本專案 house style（Noto Sans TC、13px 內文、16px 圓角、
// 單色面 + 單一 signal 強調），不引官方 MarkdownText 樣式。表格放進可橫向捲動的容器，
// 避免撐破浮窗寬度。串流期間 text 會逐步增長，react-markdown 會就地重渲染、語意安全。
import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

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
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
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

function RichTextImpl({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}

// 串流期間同一則訊息會以遞增的 text 反覆重渲染；memo 避免 sibling 連帶重算。
export const RichText = memo(RichTextImpl);
