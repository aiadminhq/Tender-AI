// 小助手串流 client：對接後端 POST /assistant/chat（NDJSON 串流）。
// 後端事件序：meta（scope + 證據來源）→ delta（注意：text 為「累積全文」，前端 replace 而非 append）→ done。
// 契約見 tender-ai-backend/app/schemas/assistant.py。失敗時 throw，由 UI fallback。
import type { SourceKey } from "@/types/domain";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1";

function authHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  return key ? { "X-API-Key": key } : {};
}

// 對齊後端 AssistantSourceOut。
// 標案類（tender/semantic/similar）帶 tenderId 與 url；知識庫類（knowledge）tenderId 為
// null，改帶 docId/heading 指向文件與區段（source 固定為「知識庫」）。
export interface AssistantSource {
  kind: "tender" | "semantic" | "similar" | "knowledge";
  tenderId: number | null;
  title: string;
  source: SourceKey | string;
  url: string | null;
  score: number | null;
  excerpt: string | null;
  docId: string | null;
  heading: string | null;
}

// 前端對話訊息（assistant-ui 風格的簡化版）。
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface MetaEvent {
  type: "meta";
  scope: string;
  prompt: string;
  sources: {
    kind: AssistantSource["kind"];
    tender_id: number | null;
    title: string;
    source: string;
    url: string | null;
    score: number | null;
    excerpt: string | null;
    doc_id: string | null;
    heading: string | null;
  }[];
}
interface DeltaEvent {
  type: "delta";
  text: string;
}
interface DoneEvent {
  type: "done";
}
type StreamEvent = MetaEvent | DeltaEvent | DoneEvent;

export interface StreamHandlers {
  onMeta?: (scope: string, sources: AssistantSource[]) => void;
  /** delta.text 為累積全文 → 直接 replace 當前助手訊息內容。 */
  onText?: (fullText: string) => void;
  onDone?: () => void;
}

function adaptSource(s: MetaEvent["sources"][number]): AssistantSource {
  return {
    kind: s.kind,
    tenderId: s.tender_id,
    title: s.title,
    source: s.source,
    url: s.url,
    score: s.score,
    excerpt: s.excerpt,
    docId: s.doc_id ?? null,
    heading: s.heading ?? null,
  };
}

/**
 * 串流一次助手對話。把整段歷史送上去（後端取最後一則 user 訊息為主），
 * 逐行解析 NDJSON 並回呼。signal 可中止；任何網路/HTTP 錯誤 throw。
 */
export async function streamAssistantChat(
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body = {
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.text }],
    })),
  };

  const res = await fetch(`${API_BASE}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`assistant API ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt: StreamEvent;
    try {
      evt = JSON.parse(trimmed) as StreamEvent;
    } catch {
      return; // 半行/雜訊：略過
    }
    if (evt.type === "meta") {
      handlers.onMeta?.(evt.scope, evt.sources.map(adaptSource));
    } else if (evt.type === "delta") {
      handlers.onText?.(evt.text);
    } else if (evt.type === "done") {
      handlers.onDone?.();
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) handleLine(buf); // 收尾未換行的最後一段
}
