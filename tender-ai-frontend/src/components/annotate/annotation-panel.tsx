// 標註輸入彈窗：點到某個 DOM 後浮出，輸入建議＋選類型／嚴重度。
// 定位沿用 SelectionMenu 模式（fixed + useLayoutEffect 量測後 clamp，不靠 transform 定位）。
import { useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useApp } from "@/store/app-context";
import { cn } from "@/lib/utils";
import {
  ANNOTATION_SEVERITIES,
  ANNOTATION_TYPES,
  type AnnotationSeverity,
  type AnnotationType,
} from "@/lib/annotate/types";
import type { TextKey } from "@/i18n/strings";

export interface PanelTarget {
  selector: string;
  componentGuess: string;
  textSnapshot: string;
  pointer: { x: number; y: number };
}

const TYPE_KEY: Record<AnnotationType, TextKey> = {
  visual: "annTypeVisual",
  interaction: "annTypeInteraction",
  copy: "annTypeCopy",
  layout: "annTypeLayout",
  other: "annTypeOther",
};

const SEVERITY_KEY: Record<AnnotationSeverity, TextKey> = {
  suggest: "annSevSuggest",
  important: "annSevImportant",
  blocker: "annSevBlocker",
};

const SEVERITY_ACCENT: Record<AnnotationSeverity, string> = {
  suggest: "data-[on=true]:border-signal data-[on=true]:text-signal",
  important: "data-[on=true]:border-tier-mid data-[on=true]:text-tier-mid",
  blocker: "data-[on=true]:border-danger data-[on=true]:text-danger",
};

export function AnnotationPanel({
  target,
  onSubmit,
  onClose,
}: {
  target: PanelTarget;
  onSubmit: (v: {
    type: AnnotationType;
    severity: AnnotationSeverity;
    comment: string;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [type, setType] = useState<AnnotationType>("visual");
  const [severity, setSeverity] = useState<AnnotationSeverity>("suggest");
  const [comment, setComment] = useState("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    const { x, y } = target.pointer;
    const left = x + w + pad <= window.innerWidth ? x : Math.max(pad, x - w);
    const top = y + h + pad <= window.innerHeight ? y : Math.max(pad, y - h);
    setPos({ left, top });
    taRef.current?.focus();
  }, [target]);

  function submit() {
    onSubmit({ type, severity, comment });
  }

  return (
    <div
      ref={ref}
      data-annotate-ui
      role="dialog"
      aria-label={t("annPanelHeading")}
      className="fixed z-[60] w-[300px] animate-in fade-in zoom-in-95 duration-100 rounded-lg border border-border bg-popover p-3 shadow-[var(--elev-overlay)]"
      style={{
        left: pos?.left ?? target.pointer.x,
        top: pos?.top ?? target.pointer.y,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-ink">
            {t("annPanelHeading")}
          </div>
          <div
            className="truncate text-[11px] text-ink-muted"
            title={target.selector}
          >
            {t("annComponent")}：
            <span className="font-num text-ink-muted">
              {target.componentGuess || "—"}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("annCancel")}
          className="grid size-6 shrink-0 place-items-center rounded-md text-ink-dim hover:bg-accent hover:text-ink"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      <textarea
        ref={taRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("annCommentPlaceholder")}
        rows={3}
        className="mb-2 w-full resize-none rounded-md border border-border bg-surface-1 px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-dim focus:border-signal"
      />

      <div className="mb-1.5 flex flex-wrap gap-1">
        {ANNOTATION_TYPES.map((ty) => (
          <Chip
            key={ty}
            on={type === ty}
            label={t(TYPE_KEY[ty])}
            onClick={() => setType(ty)}
          />
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {ANNOTATION_SEVERITIES.map((sv) => (
          <Chip
            key={sv}
            on={severity === sv}
            label={t(SEVERITY_KEY[sv])}
            accent={SEVERITY_ACCENT[sv]}
            onClick={() => setSeverity(sv)}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-2.5 py-1.5 text-[12px] text-ink-muted hover:bg-accent hover:text-ink"
          onClick={onClose}
        >
          {t("annCancel")}
        </button>
        <button
          type="button"
          disabled={!comment.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-signal px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          onClick={submit}
        >
          <Check size={14} />
          {t("annSubmit")}
        </button>
      </div>
    </div>
  );
}

function Chip({
  on,
  label,
  accent,
  onClick,
}: {
  on: boolean;
  label: string;
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-on={on}
      onClick={onClick}
      className={cn(
        "rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-ink-dim",
        "data-[on=true]:border-signal data-[on=true]:bg-signal/10 data-[on=true]:text-signal",
        accent,
      )}
    >
      {label}
    </button>
  );
}
