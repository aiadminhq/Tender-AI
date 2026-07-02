// 標註工具的 module-level store（不動 provider 樹，用 useSyncExternalStore 訂閱）。
// - enabled：標註模式開關，暫態（不持久化、重整關閉）。
// - annotations：持久化到 localStorage，重整不掉。

import { useSyncExternalStore } from "react";
import { getToken } from "@/lib/auth-token";
import { serializeAnnotations } from "./serialize";
import type {
  Annotation,
  AnnotationSeverity,
  AnnotationType,
  DesignFeedbackTarget,
} from "./types";

const STORAGE_KEY = "tender-ai:design-feedback";
const FEEDBACK_ENDPOINT = "/__design-feedback";
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "/api/v1" : "http://localhost:8000/api/v1");

interface State {
  enabled: boolean;
  annotations: Annotation[];
}

let state: State = {
  enabled: false,
  annotations: loadAnnotations(),
};

const listeners = new Set<() => void>();

function loadAnnotations(): Annotation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Annotation[]) : [];
  } catch {
    return [];
  }
}

function persist(annotations: Annotation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
  } catch {
    /* localStorage 滿了或被禁用時，忽略——記憶體狀態仍可用 */
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

// ── 對外操作 ───────────────────────────────────────────────

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): State {
  return state;
}

export function setEnabled(enabled: boolean): void {
  setState({ enabled });
}

export function toggleEnabled(): void {
  setState({ enabled: !state.enabled });
}

export interface NewAnnotationInput {
  route: string;
  selector: string;
  componentGuess: string;
  textSnapshot: string;
  rect: Annotation["rect"];
  type: AnnotationType;
  severity: AnnotationSeverity;
  comment: string;
}

export function addAnnotation(input: NewAnnotationInput): Annotation {
  const annotation: Annotation = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    createdAt: new Date().toISOString(),
    ...input,
  };
  const annotations = [...state.annotations, annotation];
  persist(annotations);
  setState({ annotations });
  return annotation;
}

export function removeAnnotation(id: string): void {
  const annotations = state.annotations.filter((a) => a.id !== id);
  persist(annotations);
  setState({ annotations });
}

export function clearAnnotations(): void {
  persist([]);
  setState({ annotations: [] });
}

// ── React hooks ───────────────────────────────────────────

export function useAnnotateState(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ── 回傳給 CLI（hybrid：寫檔優先，後援複製／下載）─────────────

export type ExportOutcome =
  | { ok: true; via: "file"; path?: string }
  | { ok: true; via: "backend"; batchId?: string }
  | { ok: true; via: "clipboard" }
  | { ok: true; via: "download" }
  | { ok: false; error: string };

/**
 * 匯出目前所有標註：
 *  1) 先試寫檔（POST 到 dev middleware → design-feedback/inbox.md）。
 *  2) 失敗則複製到剪貼簿。
 *  3) 再失敗則觸發 .md 下載。
 * 不論結果為何，markdown 內容都會回傳給呼叫端顯示。
 */
export async function exportAnnotations(
  target: DesignFeedbackTarget = "local",
): Promise<{
  outcome: ExportOutcome;
  markdown: string;
}> {
  const markdown = serializeAnnotations(
    state.annotations,
    new Date().toISOString(),
  );
  const targetCli = targetToCli(target);

  if (target === "backend") {
    const backend = await postBackend(targetCli);
    if (backend.ok) return { outcome: backend, markdown };
  }

  // 1) 寫檔（dev only；正式 build 無此端點會 fetch 失敗 → 落到後援）
  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown,
        annotations: state.annotations,
        targetCli,
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { path?: string };
      if (targetCli) void postBackend(targetCli);
      return { outcome: { ok: true, via: "file", path: data.path }, markdown };
    }
  } catch {
    /* fall through */
  }

  // 2) 剪貼簿
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
      return { outcome: { ok: true, via: "clipboard" }, markdown };
    }
  } catch {
    /* fall through */
  }

  // 3) 下載
  try {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "design-feedback.md";
    a.click();
    URL.revokeObjectURL(url);
    return { outcome: { ok: true, via: "download" }, markdown };
  } catch (e) {
    return {
      outcome: { ok: false, error: e instanceof Error ? e.message : String(e) },
      markdown,
    };
  }
}

function targetToCli(target: DesignFeedbackTarget): string | null {
  return target === "local" || target === "backend" ? null : target;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  if (key) headers["X-API-Key"] = key;
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function postBackend(
  targetCli: string | null,
): Promise<Extract<ExportOutcome, { via: "backend" }> | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}/design-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        source: "annotation",
        target_cli: targetCli,
        items: state.annotations.map((a) => ({
          route: a.route,
          selector: a.selector,
          component_guess: a.componentGuess,
          text_snapshot: a.textSnapshot,
          rect: a.rect,
          type: a.type,
          severity: a.severity,
          comment: a.comment,
          created_at: a.createdAt,
        })),
      }),
    });
    if (!res.ok) return { ok: false, error: `design feedback API ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { batch_id?: string };
    return { ok: true, via: "backend", batchId: data.batch_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
