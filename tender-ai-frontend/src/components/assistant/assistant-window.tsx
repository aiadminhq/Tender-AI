import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  GripHorizontal,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app-context";
import { trackEvent } from "@/lib/events";
import { cn } from "@/lib/utils";

type AssistantMode = "sidebar" | "float";

interface Position {
  x: number;
  y: number;
}

const MODE_STORAGE_KEY = "tender-assistant-mode";
const VIEWPORT_MARGIN = 16;

function loadMode(): AssistantMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "float"
      ? "float"
      : "sidebar";
  } catch {
    return "sidebar";
  }
}

function saveMode(mode: AssistantMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* 隱私模式或 quota 滿時，保留當次 session 狀態即可。 */
  }
}

function clampPosition(
  position: Position,
  width: number,
  height: number,
): Position {
  return {
    x: Math.min(
      Math.max(VIEWPORT_MARGIN, position.x),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    ),
    y: Math.min(
      Math.max(VIEWPORT_MARGIN, position.y),
      Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
    ),
  };
}

export function AssistantWindow({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useApp();
  const [mode, setMode] = useState<AssistantMode>(loadMode);
  const [position, setPosition] = useState<Position>({
    x: VIEWPORT_MARGIN,
    y: VIEWPORT_MARGIN,
  });
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      trackEvent("view", {
        payload: { scope: "assistant_open", mode },
      });
    }
    wasOpenRef.current = open;
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    if (mode === "sidebar") document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      if (mode === "sidebar") document.body.style.overflow = "";
    };
  }, [mode, onClose, open]);

  useEffect(() => {
    if (!open || mode !== "float") return;

    const placeInViewport = (bottomRight = false) => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setPosition((current) =>
        clampPosition(
          bottomRight
            ? {
                x: window.innerWidth - rect.width - 24,
                y: window.innerHeight - rect.height - 24,
              }
            : current,
          rect.width,
          rect.height,
        ),
      );
    };

    const frame = window.requestAnimationFrame(() => placeInViewport(true));
    const onResize = () => placeInViewport(false);
    const observer = new ResizeObserver(() => placeInViewport(false));
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [mode, open]);

  if (!open) return null;

  const toggleMode = () => {
    const nextMode: AssistantMode = mode === "sidebar" ? "float" : "sidebar";
    saveMode(nextMode);
    setMode(nextMode);
    trackEvent("view", {
      payload: { scope: "assistant_open", mode: nextMode },
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "float" || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || drag.pointerId !== event.pointerId) return;
    const rect = panel.getBoundingClientRect();
    setPosition(
      clampPosition(
        {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        },
        rect.width,
        rect.height,
      ),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const surface = (
    <section
      ref={mode === "float" ? panelRef : undefined}
      role="dialog"
      aria-modal={mode === "sidebar"}
      style={mode === "float" ? { left: position.x, top: position.y } : undefined}
      className={cn(
        "flex flex-col overflow-hidden border border-border bg-popover shadow-[0_1px_2px_rgba(0,0,0,.06)]",
        mode === "sidebar"
          ? "relative h-full w-full border-y-0 border-r-0 sm:max-w-lg"
          : "fixed z-[45] h-[min(640px,calc(100vh-2rem))] min-h-80 max-h-[calc(100vh-2rem)] w-[min(420px,calc(100vw-2rem))] min-w-0 max-w-[calc(100vw-2rem)] resize rounded-2xl sm:min-w-80",
      )}
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "flex touch-none items-center justify-between gap-3 border-b border-border px-4 py-3",
          mode === "float" && "cursor-move",
        )}
      >
        <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
          {mode === "float" ? (
            <GripHorizontal size={15} className="shrink-0 text-ink-dim" />
          ) : (
            <Sparkles size={15} className="shrink-0 text-primary" />
          )}
          <span className="truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleMode}
            aria-label={mode === "sidebar" ? t("restore") : t("maximize")}
            title={mode === "sidebar" ? t("restore") : t("maximize")}
          >
            {mode === "sidebar" ? (
              <Minimize2 size={16} />
            ) : (
              <Maximize2 size={16} />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label={t("close")}
            title={t("close")}
          >
            <X size={16} />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {children}
      </div>
      {footer && (
        <footer className="border-t border-border px-4 py-3">{footer}</footer>
      )}
    </section>
  );

  return createPortal(
    mode === "float" ? (
      surface
    ) : (
      <div className="fixed inset-0 z-[45] flex justify-end">
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-black/55 animate-in fade-in"
          onClick={onClose}
          aria-label={t("close")}
        />
        {surface}
      </div>
    ),
    document.body,
  );
}
