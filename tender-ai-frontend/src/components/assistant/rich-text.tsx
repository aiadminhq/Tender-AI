// 輕量 markdown 渲染器：只覆蓋後端 assistant._format_answer 會輸出的子集
// （### 標題、編號清單、[text](url) 連結、**粗體**、段落）。
// 刻意不引入 react-markdown：沙箱無法 npm install，且後端輸出格式固定、子集足夠。
import { Fragment, type ReactNode } from "react";

const INLINE = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)/g;

// 行內：解析連結與粗體，其餘原樣輸出。
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  let i = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      // [label](url)
      out.push(
        <a
          key={`${keyBase}-a${i}`}
          href={m[3]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      // **bold**
      out.push(
        <strong
          key={`${keyBase}-b${i}`}
          className="font-semibold text-foreground"
        >
          {m[5]}
        </strong>,
      );
    }
    last = INLINE.lastIndex;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 區塊：以空行切段，辨識 ### 標題與連續編號清單，其餘為段落。
export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    const k = key++;
    blocks.push(
      <ol key={`ol-${k}`} className="space-y-1.5 text-[13px] leading-relaxed">
        {items.map((it, idx) => (
          <li key={idx} className="flex gap-2">
            <span className="tnum shrink-0 text-ink-dim">{idx + 1}.</span>
            <span className="min-w-0">
              {renderInline(it, `ol-${k}-${idx}`)}
            </span>
          </li>
        ))}
      </ol>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const listMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    if (line.startsWith("### ")) {
      blocks.push(
        <h3
          key={`h-${key++}`}
          className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
        >
          {line.slice(4)}
        </h3>,
      );
    } else {
      const k = key++;
      blocks.push(
        <p
          key={`p-${k}`}
          className="text-[13px] leading-relaxed text-foreground/90"
        >
          {renderInline(line, `p-${k}`)}
        </p>,
      );
    }
  }
  flushList();

  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
