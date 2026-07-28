// 標註工具的 module-level store（不動 provider 樹，用 useSyncExternalStore 訂閱）。
// - enabled：標註模式開關，暫態（不持久化、重整關閉）。
// - annotations：持久化到 localStorage，重整不掉。

import { useSyncExternalStore } from "react";
import { API_BASE } from "@/lib/api-base";
import { getToken } from "@/lib/auth-token";
import { serializeAnnotations } from "./serialize";
import type {
  Annotation,
  AnnotationSeverity,
  AnnotationType,
  DesignFeedbackTarget,
} from "./types";

const STORAGE_KEY = "tender-ai:design-feedback";
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

// ── 回饋交接（僅複製／下載，絕不自動啟動 CLI）──────────────────

export type ExportOutcome =
  | {
      ok: true;
      via: "handoff";
      targetCli: string;
      delivery: "clipboard" | "download";
    }
  | { ok: true; via: "backend"; batchId?: string }
  | { ok: true; via: "clipboard" }
  | { ok: true; via: "download" }
  | { ok: false; error: string };

/**
 * 匯出目前所有標註：CLI 目標產生可複製的任務提示詞；本地目標複製原始 Markdown。
 * 不會寫入交接檔案，也不會啟動任何 CLI 程序。
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

  if (targetCli) {
    const prompt = renderHandoffPrompt(targetCli, markdown);
    const delivery = await copyOrDownload(
      prompt,
      "tender-ai-design-feedback-task.md",
    );
    if (delivery.ok) {
      void postBackend(targetCli);
      return {
        outcome: {
          ok: true,
          via: "handoff",
          targetCli,
          delivery: delivery.via,
        },
        markdown: prompt,
      };
    }
    return { outcome: delivery, markdown: prompt };
  }

  if (target === "backend") {
    const backend = await postBackend(targetCli);
    if (backend.ok) return { outcome: backend, markdown };
  }

  const delivery = await copyOrDownload(markdown, "design-feedback.md");
  return { outcome: delivery, markdown };
}

async function copyOrDownload(
  content: string,
  filename: string,
): Promise<
  { ok: true; via: "clipboard" | "download" } | { ok: false; error: string }
> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      return { ok: true, via: "clipboard" };
    }
  } catch {
    /* fall through */
  }

  try {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true, via: "download" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function targetToCli(target: DesignFeedbackTarget): string | null {
  return target === "local" || target === "backend" ? null : target;
}

function renderHandoffPrompt(targetCli: string, markdown: string): string {
  return `# Tender AI 設計回饋交接 → ${targetCli}

請依下列已選取的真實介面回饋執行修改。不要自行啟動其他 CLI、不要寫入交接檔案，也不要變更未列出的工作範圍。

PURPOSE: 將已標註的 UI/UX 問題收斂為最小且可驗證的 Tender AI 改動。
TASK: 閱讀每則回饋 | 對照目前元件與資料欄位 | 實作必要修改 | 執行相關 build／tests | 回報變更檔案與驗證結果。
CONTEXT: tender-ai-frontend/src/**/* | tender-ai-backend/app/**/* | docs/design-feedback-workflow.md
EXPECTED: 只處理本批標註；說明每則回饋如何處理；列出未處理的阻礙（若有）。
CONSTRAINTS: 保留既有設計系統與真實資料契約 | 不碰無關 WIP | 不要自動 stage 或 commit。

${markdown}
`;
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
): Promise<
  Extract<ExportOutcome, { via: "backend" }> | { ok: false; error: string }
> {
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
    if (!res.ok)
      return { ok: false, error: `design feedback API ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { batch_id?: string };
    return { ok: true, via: "backend", batchId: data.batch_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
