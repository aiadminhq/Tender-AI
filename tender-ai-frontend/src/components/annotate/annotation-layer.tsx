// 全站標註層：掛在 BrowserRouter 內、Routes 外（涵蓋所有頁面，含獨立路由）。
// 開啟後 → capture 階段攔截 hover/click，點任一 DOM 浮出彈窗輸入建議；
// 已建立的標註以 pin 標記，dock 可檢視／刪除／匯出給 CLI。
//
// 僅供開發期使用：掛載點以 import.meta.env.DEV 把關，正式 build 不含此層。
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Download, Trash2, X } from "lucide-react";
import { useApp } from "@/store/app-context";
import {
  buildSelector,
  guessComponent,
  textSnapshot,
} from "@/lib/annotate/selector";
import {
  addAnnotation,
  clearAnnotations,
  exportAnnotations,
  removeAnnotation,
  setEnabled,
  useAnnotateState,
  type ExportOutcome,
} from "@/lib/annotate/store";
import type { Annotation } from "@/lib/annotate/types";
import { severityMark, typeLabel } from "@/lib/annotate/serialize";
import { AnnotationPanel, type PanelTarget } from "./annotation-panel";
import { AnnotationPins } from "./annotation-pin";

function isOwnUI(node: EventTarget | null): boolean {
  return node instanceof Element && !!node.closest("[data-annotate-ui]");
}

export function AnnotationLayer() {
  const { t } = useApp();
  const { enabled, annotations } = useAnnotateState();
  const route = useLocation().pathname;

  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [target, setTarget] = useState<PanelTarget | null>(null);
  const [pending, setPending] = useState<Omit<
    Annotation,
    "id" | "createdAt" | "type" | "severity" | "comment"
  > | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const close = useCallback(() => {
    setTarget(null);
    setPending(null);
    setHoverRect(null);
  }, []);

  // capture 階段攔截滑鼠（只在 enabled 且彈窗未開時追蹤 hover）。
  useEffect(() => {
    if (!enabled) {
      setHoverRect(null);
      return;
    }

    const onMove = (e: MouseEvent) => {
      if (target) return; // 彈窗開啟時凍結選取
      if (isOwnUI(e.target)) {
        setHoverRect(null);
        return;
      }
      const el = e.target as Element | null;
      if (!el || el.nodeType !== 1) return;
      setHoverRect(el.getBoundingClientRect());
    };

    const onClick = (e: MouseEvent) => {
      if (isOwnUI(e.target)) return; // 自家 UI 放行
      const el = e.target as Element | null;
      if (!el || el.nodeType !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      setPending({
        route,
        selector: buildSelector(el),
        componentGuess: guessComponent(el),
        textSnapshot: textSnapshot(el),
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
      setTarget({
        selector: buildSelector(el),
        componentGuess: guessComponent(el),
        textSnapshot: textSnapshot(el),
        pointer: { x: e.clientX, y: e.clientY },
      });
      setHoverRect(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (target) close();
      else setEnabled(false);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [enabled, target, route, close]);

  // 換頁時收掉開啟中的彈窗。
  useEffect(() => {
    close();
  }, [route, close]);

  if (!enabled && annotations.length === 0) return null;

  const onRoute = annotations.filter((a) => a.route === route);
  const numberOf = (id: string) =>
    annotations.findIndex((a) => a.id === id) + 1;

  async function onExport() {
    setStatus(t("annExporting"));
    const { outcome } = await exportAnnotations();
    setStatus(t(outcomeKey(outcome)));
    window.setTimeout(() => setStatus(null), 4000);
  }

  return (
    <>
      {/* hover 高亮框 */}
      {enabled && hoverRect && !target && (
        <div
          data-annotate-ui
          className="pointer-events-none fixed z-[52] rounded-[4px] border-2 border-signal bg-signal/10"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}

      {/* 既有標註的 pin（永遠顯示在目前頁面，方便回看） */}
      <AnnotationPins
        annotations={onRoute}
        numberOf={numberOf}
        activeId={activeId}
        onSelect={setActiveId}
      />

      {/* 輸入彈窗 */}
      {target && pending && (
        <AnnotationPanel
          target={target}
          onClose={close}
          onSubmit={({ type, severity, comment }) => {
            addAnnotation({ ...pending, type, severity, comment });
            close();
          }}
        />
      )}

      {/* dock：開啟模式時常駐右下，檢視／刪除／匯出 */}
      {enabled && (
        <div
          data-annotate-ui
          className="fixed bottom-4 right-4 z-[58] flex max-h-[60vh] w-80 flex-col rounded-lg border border-border bg-popover shadow-[var(--elev-overlay)] animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="text-[12px] font-semibold text-ink">
              {t("annDockTitle")}
              <span className="ml-1.5 font-num text-ink-muted">
                {annotations.length} {t("annNoteUnit")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {annotations.length > 0 && (
                <button
                  type="button"
                  onClick={clearAnnotations}
                  className="rounded-md px-1.5 py-1 text-[11px] text-ink-dim hover:bg-accent hover:text-danger"
                >
                  {t("annClear")}
                </button>
              )}
              <button
                type="button"
                aria-label={t("annExit")}
                title={t("annExit")}
                onClick={() => setEnabled(false)}
                className="grid size-6 place-items-center rounded-md text-ink-dim hover:bg-accent hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {annotations.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-ink-dim">
                {t("annEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {annotations.map((a, i) => (
                  <li
                    key={a.id}
                    onMouseEnter={() => setActiveId(a.id)}
                    onMouseLeave={() => setActiveId(null)}
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <span className="mt-0.5 font-num text-[11px] text-ink-dim">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-ink">
                        {severityMark(a.severity)} {a.comment || "—"}
                      </p>
                      <p className="truncate text-[10px] text-ink-dim">
                        {typeLabel(a.type)} · {a.componentGuess} ·{" "}
                        <span className="font-num">{a.route}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t("annRemove")}
                      title={t("annRemove")}
                      onClick={() => removeAnnotation(a.id)}
                      className="grid size-6 shrink-0 place-items-center rounded-md text-ink-dim opacity-0 hover:bg-canvas hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="truncate text-[11px] text-ink-muted">
              {status ?? t("annHintBar")}
            </span>
            <button
              type="button"
              disabled={annotations.length === 0}
              onClick={onExport}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-signal px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
            >
              <Download size={13} />
              {t("annExport")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function outcomeKey(outcome: ExportOutcome) {
  if (!outcome.ok) return "annExportFailed" as const;
  if (outcome.via === "file") return "annExportedFile" as const;
  if (outcome.via === "clipboard") return "annExportedClipboard" as const;
  return "annExportedDownload" as const;
}
