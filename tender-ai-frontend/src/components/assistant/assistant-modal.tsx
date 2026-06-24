// 非阻擋式小助手浮窗（自管 position:fixed 面板，取代原 Radix Popover 容器）：
//   1. 兩種型態：floating（右下角浮窗，預設高度 = fit content）與 sidebar（貼右側、滿版高度）；
//      標題列右側「切換側邊欄」鈕互切。型態 + 尺寸記在 localStorage，跨 session 還原。
//   2. floating 錨定右下角，左上角有縮放把手 → 往左上長、右下角固定；寬高即時記憶。
//      sidebar 左緣有縮放把手 → 調整寬度。皆以 pointer capture 拖曳，min/max 夾住不破版。
//   3. 全程無遮罩、不鎖背景；點外面不關閉，由 FAB 或關閉鈕收合（與原行為一致）。
//   4. 房屋風格 tokens（bg-popover / border-border / rounded-2xl / 輕陰影 / animate-in）。
// 內容即共用的 AssistantUIThread；對話狀態由外層 <AssistantRuntime> 提供（不依賴 Popover context）。
import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Bot,
  ChevronDown,
  Minimize2,
  PanelRight,
  PanelsTopLeft,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { cn } from "@/lib/utils";
import { AssistantUIThread } from "./assistant-ui-thread";
import { useAssistantBridge } from "./assistant-runtime-provider";

interface AssistantModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目前正在檢視的標案 id（在 /tenders/:id 時）→ 指揮中心帶情境。 */
  tenderId: string | null;
}

type PanelMode = "floating" | "sidebar";

interface PanelState {
  mode: PanelMode;
  /** floating 寬度（px）。 */
  floatW: number;
  /** floating 高度（px）；null = fit content（預設）。 */
  floatH: number | null;
  /** sidebar 寬度（px）。 */
  sidebarW: number;
}

const STORAGE_KEY = "tender-assistant-panel";
const DEFAULT_STATE: PanelState = {
  mode: "floating",
  floatW: 400,
  floatH: null,
  sidebarW: 420,
};
const MIN_W = 320;
const MIN_H = 280;

function loadState(): PanelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      mode: parsed.mode === "sidebar" ? "sidebar" : "floating",
      floatW:
        typeof parsed.floatW === "number"
          ? parsed.floatW
          : DEFAULT_STATE.floatW,
      floatH: typeof parsed.floatH === "number" ? parsed.floatH : null,
      sidebarW:
        typeof parsed.sidebarW === "number"
          ? parsed.sidebarW
          : DEFAULT_STATE.sidebarW,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

export function AssistantModal({
  open,
  onOpenChange,
  tenderId,
}: AssistantModalProps) {
  const [state, setState] = useState<PanelState>(loadState);
  const isSidebar = state.mode === "sidebar";

  // 尺寸／型態變更即落地 localStorage（跨 session 還原）。
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 忽略隱私模式等寫入失敗 */
    }
  }, [state]);

  return (
    <>
      {/* FAB：closed 或 floating 時顯示（sidebar 開啟時面板已佔右緣，改由標題列關閉）。
          以 portal 送到 body：launcher 掛在 sticky topbar 內，固定定位需以 viewport 為準。 */}
      {(!open || !isSidebar) &&
        createPortal(
          <div className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6">
            <FabButton open={open} onClick={() => onOpenChange(!open)} />
          </div>,
          document.body,
        )}

      {open &&
        createPortal(
          <AssistantPanel
            state={state}
            setState={setState}
            tenderId={tenderId}
            onClose={() => onOpenChange(false)}
          />,
          document.body,
        )}
    </>
  );
}

// ── 面板本體 ──────────────────────────────────────────────────────────────────

function AssistantPanel({
  state,
  setState,
  tenderId,
  onClose,
}: {
  state: PanelState;
  setState: React.Dispatch<React.SetStateAction<PanelState>>;
  tenderId: string | null;
  onClose: () => void;
}) {
  const { t } = useApp();
  const isSidebar = state.mode === "sidebar";
  const dragRef = useRef<{
    startX: number;
    startY: number;
    w: number;
    h: number;
  } | null>(null);

  // 左上角（floating）／左緣（sidebar）縮放：pointer capture 拖曳，min/max 夾住。
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startW = isSidebar ? state.sidebarW : state.floatW;
    const startH =
      state.floatH ??
      // fit-content 起手：以實際面板高度為基準，縮放才連續不跳。
      el.closest("[data-assistant-panel]")?.getBoundingClientRect().height ??
      DEFAULT_STATE.floatH ??
      MIN_H;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      w: startW,
      h: startH,
    };
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = d.startX - e.clientX; // 往左拖 → 變大
    if (isSidebar) {
      const maxW = window.innerWidth - 48;
      setState((s) => ({ ...s, sidebarW: clamp(d.w + dx, MIN_W, maxW) }));
    } else {
      const dy = d.startY - e.clientY; // 往上拖 → 變高
      const maxW = window.innerWidth - 32;
      const maxH = window.innerHeight - 96;
      setState((s) => ({
        ...s,
        floatW: clamp(d.w + dx, MIN_W, maxW),
        floatH: clamp(d.h + dy, MIN_H, maxH),
      }));
    }
  };

  const onResizePointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const toggleMode = () =>
    setState((s) => ({
      ...s,
      mode: s.mode === "sidebar" ? "floating" : "sidebar",
    }));

  // 容器定位／尺寸。
  const style: React.CSSProperties = isSidebar
    ? { width: state.sidebarW }
    : {
        width: `min(${state.floatW}px, calc(100vw - 2rem))`,
        ...(state.floatH != null
          ? { height: state.floatH }
          : { maxHeight: "calc(100svh - 7rem)" }),
      };

  return (
    <div
      data-assistant-panel
      style={style}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden bg-popover text-popover-foreground",
        "animate-in fade-in",
        isSidebar
          ? "right-0 top-0 bottom-0 h-svh border-l border-border shadow-[-8px_0_24px_-12px_rgba(0,0,0,.18)] slide-in-from-right-4"
          : "bottom-20 right-4 rounded-2xl border border-border shadow-lg zoom-in-95 slide-in-from-bottom-2 md:bottom-6 md:right-6",
      )}
    >
      {/* 縮放把手：floating → 左上角；sidebar → 左緣整條。 */}
      {isSidebar ? (
        <div
          role="separator"
          aria-label={t("assistantResize")}
          title={t("assistantResize")}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize touch-none hover:bg-signal/30"
        />
      ) : (
        <div
          role="separator"
          aria-label={t("assistantResize")}
          title={t("assistantResize")}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          className="group absolute left-0 top-0 z-10 grid h-5 w-5 cursor-nwse-resize touch-none place-items-center"
        >
          <span className="h-2 w-2 rounded-br-sm border-l-2 border-t-2 border-ink-dim/50 transition-colors group-hover:border-signal" />
        </div>
      )}

      <ModalHeader
        tenderId={tenderId}
        isSidebar={isSidebar}
        onToggleMode={toggleMode}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1">
        <AssistantUIThread />
      </div>
    </div>
  );
}

// FAB：開啟時 Bot 淡出、ChevronDown 浮現（提示「收合」）。
const FabButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & { open: boolean }
>(function FabButton({ open, ...props }, ref) {
  const { t } = useApp();
  return (
    <button
      {...props}
      type="button"
      ref={ref}
      aria-label={t("assistantOpen")}
      title={t("assistantOpen")}
      className="group relative grid h-14 w-14 place-items-center rounded-2xl bg-signal text-white outline-none shadow-[0_8px_24px_-8px_var(--signal-ring),0_2px_8px_-3px_rgba(0,0,0,.18)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-10px_var(--signal-ring),0_4px_12px_-4px_rgba(0,0,0,.2)] active:translate-y-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <Bot
        size={23}
        className={cn(
          "absolute transition-all",
          open
            ? "rotate-90 scale-0 opacity-0"
            : "rotate-0 scale-100 opacity-100",
        )}
      />
      <ChevronDown
        size={24}
        className={cn(
          "absolute transition-all",
          open
            ? "rotate-0 scale-100 opacity-100"
            : "rotate-[-90deg] scale-0 opacity-0",
        )}
      />
    </button>
  );
});

function ModalHeader({
  tenderId,
  isSidebar,
  onToggleMode,
  onClose,
}: {
  tenderId: string | null;
  isSidebar: boolean;
  onToggleMode: () => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const { clear, hasTurns } = useAssistantBridge();
  const commandCenterTo = tenderId
    ? `/assistant?tender=${tenderId}`
    : "/assistant";

  const iconBtn =
    "grid h-7 w-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-accent hover:text-foreground";

  return (
    <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
        <Bot size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
        {t("assistantTitle")}
      </span>
      {hasTurns && (
        <button
          type="button"
          onClick={clear}
          title={t("assistantClear")}
          aria-label={t("assistantClear")}
          className={iconBtn}
        >
          <Trash2 size={14} />
        </button>
      )}
      <Link
        to={commandCenterTo}
        onClick={onClose}
        title={t("assistantCommandCenterHint")}
        aria-label={t("assistantCommandCenter")}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:bg-accent hover:text-foreground"
      >
        <PanelsTopLeft size={14} />
        <span className="hidden sm:inline">{t("assistantCommandCenter")}</span>
      </Link>
      {/* 浮窗 ↔ 側邊欄切換（請求的「右邊變成 sidebar 按鈕」）。 */}
      <button
        type="button"
        onClick={onToggleMode}
        title={isSidebar ? t("assistantUndock") : t("assistantDock")}
        aria-label={isSidebar ? t("assistantUndock") : t("assistantDock")}
        className={iconBtn}
      >
        {isSidebar ? <Minimize2 size={14} /> : <PanelRight size={14} />}
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t("close")}
        aria-label={t("close")}
        className={iconBtn}
      >
        <X size={15} />
      </button>
    </div>
  );
}
