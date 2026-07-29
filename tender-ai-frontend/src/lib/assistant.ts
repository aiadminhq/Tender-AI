// 小助手串流 client：對接後端 POST /assistant/chat（NDJSON 串流）。
// 後端事件序：meta（scope + 證據來源）→ delta（注意：text 為「累積全文」，前端 replace 而非 append）→ done。
// 契約見 tender-ai-backend/app/schemas/assistant.py。失敗時 throw，由 UI fallback。
import type { SourceKey } from "@/types/domain";
import { getToken } from "@/lib/auth-token";
import { API_BASE } from "@/lib/api-base";
import type { AssistantArtifact } from "@/components/assistant/assistant-artifact-types";
import { adaptAssistantArtifact } from "@/components/assistant/assistant-artifact-adapter";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  if (key) headers["X-API-Key"] = key;
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// 對齊後端 AssistantSourceOut。
// 標案類（tender/semantic/similar）帶 tenderId 與 url；知識庫類（knowledge）tenderId 為
// null，改帶 docId/heading 指向文件與區段（source 固定為「知識庫」）。
export interface AssistantSource {
  kind: "tender" | "semantic" | "similar" | "knowledge" | "collaboration";
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

// 對話中偵測到的「長期條件」建議（confirm-to-remember）。對齊後端 PreferenceSuggestionOut。
// 偵測到只代表「建議」——使用者按確認後才會 POST state_preference 事件入庫。
export interface PreferenceSuggestion {
  kind: "region";
  op: "only" | "exclude";
  value: string;
  raw: string;
}

export interface AssistantAction {
  kind: "assign_tender" | "create_task";
  tenderId: number;
  assigneeName: string;
  assigneeUserId: number;
  title: string | null;
  requiresConfirmation: boolean;
}

interface MetaEvent {
  type: "meta";
  scope: string;
  thread_id?: string;
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
  preference_suggestion?: PreferenceSuggestion | null;
  actions?: {
    kind: AssistantAction["kind"];
    tender_id: number;
    assignee_name: string;
    assignee_user_id: number;
    title?: string | null;
    requires_confirmation?: boolean;
  }[];
}
interface DeltaEvent {
  type: "delta";
  text: string;
}
// agentic（CLI 大腦）執行過程的暫態狀態事件（對齊後端 AssistantChatProgressOut）。
// 僅暫態：UI 顯示「正在查詢…」狀態行，下一筆 delta 到達即清除；不寫入對話文字。
interface ProgressEvent {
  type: "progress";
  text: string;
}
interface ArtifactEvent {
  type: "artifact";
  artifact: unknown;
}
interface DoneEvent {
  type: "done";
}
type StreamEvent = MetaEvent | DeltaEvent | ProgressEvent | ArtifactEvent | DoneEvent;

export interface StreamHandlers {
  /** threadId 為後端回傳的對話串 id（缺 thread_id 時由後端產生）；前端據此續接同串。 */
  onMeta?: (
    scope: string,
    sources: AssistantSource[],
    threadId?: string,
  ) => void;
  /** delta.text 為累積全文 → 直接 replace 當前助手訊息內容。 */
  onText?: (fullText: string) => void;
  /** agentic 暫態狀態（CLI 大腦查詢工具中）；下一筆 onText 到達即應清除。 */
  onProgress?: (status: string) => void;
  /** 結構化 artifact（第一階段支援 table；後續 chart/save/share 沿用此 pipeline）。 */
  onArtifact?: (artifact: AssistantArtifact) => void;
  /** 偵測到對話中的長期條件時回呼（否則帶 null）；UI 據此顯示確認 chip。 */
  onPreferenceSuggestion?: (suggestion: PreferenceSuggestion | null) => void;
  onActions?: (actions: AssistantAction[]) => void;
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

function adaptAction(action: NonNullable<MetaEvent["actions"]>[number]): AssistantAction {
  return {
    kind: action.kind,
    tenderId: action.tender_id,
    assigneeName: action.assignee_name,
    assigneeUserId: action.assignee_user_id,
    title: action.title ?? null,
    requiresConfirmation: action.requires_confirmation ?? true,
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
  /** 使用者「目前正在檢視」的標案 id（情境感知接線）；後端 context.focus_tender_id 消費。 */
  focusTenderId?: string | number | null,
  /** 對話留存接線：threadId 續接同串（缺則後端產生並於 meta 回傳）；scope 寫入 context 供留存分類。 */
  opts?: { threadId?: string | null; scope?: string },
): Promise<void> {
  const body: {
    messages: { role: string; content: { type: "text"; text: string }[] }[];
    thread_id?: string;
    context?: { focus_tender_id?: string | number; scope?: string };
  } = {
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.text }],
    })),
  };
  const threadId = opts?.threadId?.trim?.() || opts?.threadId;
  if (threadId) body.thread_id = String(threadId);
  const context: { focus_tender_id?: string | number; scope?: string } = {};
  if (focusTenderId != null && String(focusTenderId).trim() !== "") {
    context.focus_tender_id = focusTenderId;
  }
  if (opts?.scope) context.scope = opts.scope;
  if (Object.keys(context).length > 0) body.context = context;

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
      handlers.onMeta?.(evt.scope, evt.sources.map(adaptSource), evt.thread_id);
      handlers.onPreferenceSuggestion?.(evt.preference_suggestion ?? null);
      handlers.onActions?.((evt.actions ?? []).map(adaptAction));
    } else if (evt.type === "delta") {
      handlers.onText?.(evt.text);
    } else if (evt.type === "progress") {
      handlers.onProgress?.(evt.text);
    } else if (evt.type === "artifact") {
      const artifact = adaptAssistantArtifact(evt.artifact);
      if (artifact) handlers.onArtifact?.(artifact);
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

// ── 對話留存：列表／詳情（hydrate 用） ──────────────────────────────
// 對齊後端 GET /assistant/threads(/{id})。Layer B 紅線：留存只含對話文字與公開
// A 層來源卡，owner 一律 default、未具名、對外永不揭露（見 CLAUDE.md）。

/** 對話串摘要（清單顯示用）。 */
export interface AssistantThreadSummary {
  id: string;
  scope: string;
  title: string | null;
}

/** 對話串歷史一則（hydrate 成 Turn 用）。 */
export interface AssistantThreadTurn {
  role: "user" | "assistant";
  text: string;
  sources?: AssistantSource[];
}

/** 對話串詳情（含完整訊息）。 */
export interface AssistantThreadDetail extends AssistantThreadSummary {
  turns: AssistantThreadTurn[];
}

interface ThreadSummaryDto {
  id: string;
  scope: string;
  title: string | null;
}
interface ThreadMessageDto {
  id: number;
  role: string;
  content: string;
  sources: MetaEvent["sources"] | null;
}
interface ThreadDetailDto extends ThreadSummaryDto {
  messages: ThreadMessageDto[];
}

/** 列出近期對話串；純 mock 模式（VITE_USE_API=false）不外連，回空陣列。 */
export async function fetchAssistantThreads(
  query?: string,
  signal?: AbortSignal,
): Promise<AssistantThreadSummary[]> {
  if (import.meta.env.VITE_USE_API === "false") return [];
  const params = new URLSearchParams();
  const q = query?.trim();
  if (q) params.set("q", q);
  const qs = params.toString();
  const url = `${API_BASE}/assistant/threads${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`assistant threads API ${res.status}`);
  const data = (await res.json()) as { threads: ThreadSummaryDto[] };
  return data.threads.map((t) => ({
    id: t.id,
    scope: t.scope,
    title: t.title,
  }));
}

/** 取單一對話串詳情；找不到（404）或純 mock 模式回 null。 */
export async function fetchAssistantThread(
  threadId: string,
  signal?: AbortSignal,
): Promise<AssistantThreadDetail | null> {
  if (import.meta.env.VITE_USE_API === "false") return null;
  const res = await fetch(
    `${API_BASE}/assistant/threads/${encodeURIComponent(threadId)}`,
    { headers: authHeaders(), signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`assistant thread API ${res.status}`);
  const data = (await res.json()) as ThreadDetailDto;
  return {
    id: data.id,
    scope: data.scope,
    title: data.title,
    turns: data.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      text: m.content,
      sources: m.sources ? m.sources.map(adaptSource) : undefined,
    })),
  };
}
