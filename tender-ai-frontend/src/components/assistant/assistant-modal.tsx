// 非阻擋式小助手面板（自管 position:fixed 容器，取代原 Radix Popover）：
//   1. 兩種型態皆「滿版高度、只調寬度」：sidebar（預設,貼齊右緣、與邊框切齊）與
//      floating（脫離右緣、四周留邊距的圓角浮窗）；標題列右側鈕互切。型態 + 寬度記在
//      localStorage,跨 session 還原。
//   2. 兩型態左緣皆有縮放把手 → 往左拖變寬、往右拖變窄（min/max 夾住不破版），
//      高度恆為滿版（不調高）。以 pointer capture 拖曳。
//   3. 全程無遮罩、不鎖背景；點外面不關閉，開啟時 FAB 收起,由標題列關閉鈕收合。
//   4. 房屋風格 tokens（bg-popover / border-border / rounded-2xl / 輕陰影 / animate-in）。
// 內容即共用的 AssistantUIThread；對話狀態由外層 <AssistantRuntime> 提供（不依賴 Popover context）。
import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Bot,
  ChevronDown,
  CircleDot,
  History,
  MessageSquareText,
  Minimize2,
  PanelRight,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { cn } from "@/lib/utils";
import { AssistantUIThread } from "./assistant-ui-thread";
import { useAssistantBridge } from "./assistant-bridge";

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
  /** sidebar 寬度（px）。 */
  sidebarW: number;
}

const STORAGE_KEY = "tender-assistant-panel";
const DEFAULT_STATE: PanelState = {
  mode: "sidebar",
  floatW: 400,
  sidebarW: 420,
};
const MIN_W = 320;

function loadState(): PanelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      mode: parsed.mode === "floating" ? "floating" : "sidebar",
      floatW:
        typeof parsed.floatW === "number"
          ? parsed.floatW
          : DEFAULT_STATE.floatW,
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
      {/* FAB：面板收合時才顯示；開啟時（兩型態皆滿版高度）面板已佔右側，改由標題列關閉鈕收合。
          以 portal 送到 body：launcher 掛在 sticky topbar 內，固定定位需以 viewport 為準。 */}
      {!open &&
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const dragRef = useRef<{
    startX: number;
    w: number;
  } | null>(null);

  // 縮放把手（兩型態共用，皆在左緣）：pointer capture 拖曳，只調寬度，min/max 夾住。
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      w: isSidebar ? state.sidebarW : state.floatW,
    };
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = d.startX - e.clientX; // 往左拖 → 變寬
    const maxW = window.innerWidth - 48;
    const next = clamp(d.w + dx, MIN_W, maxW);
    setState((s) =>
      isSidebar ? { ...s, sidebarW: next } : { ...s, floatW: next },
    );
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

  // 容器寬度（兩型態皆滿版高度，僅寬度可調）。
  const style: React.CSSProperties = isSidebar
    ? { width: state.sidebarW }
    : { width: `min(${state.floatW}px, calc(100vw - 2rem))` };

  return (
    <div
      data-assistant-panel
      style={style}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden bg-white text-popover-foreground",
        "animate-in fade-in slide-in-from-right-4",
        isSidebar
          ? "right-0 top-0 bottom-0 h-svh border-l border-border shadow-[-8px_0_24px_-12px_rgba(0,0,0,.18)]"
          : "right-4 top-4 bottom-4 rounded-2xl border border-border shadow-lg md:right-6 md:top-6 md:bottom-6",
      )}
    >
      {/* 縮放把手（兩型態共用）：左緣整條，往左拖變寬。 */}
      <div
        role="separator"
        aria-label={t("assistantResize")}
        title={t("assistantResize")}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize touch-none hover:bg-signal/30"
      />

      <ModalHeader
        tenderId={tenderId}
        isSidebar={isSidebar}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        onToggleMode={toggleMode}
        onClose={onClose}
      />
      {historyOpen && <AssistantHistoryPanel />}
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
  historyOpen,
  onToggleHistory,
  onToggleMode,
  onClose,
}: {
  tenderId: string | null;
  isSidebar: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onToggleMode: () => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const { clear, newChat, hasTurns, refreshThreads } = useAssistantBridge();
  const commandCenterTo = tenderId
    ? `/assistant?tender=${tenderId}`
    : "/assistant";

  const iconBtn =
    "grid h-7 w-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-slate-100 hover:text-foreground";
  const ctaBtn =
    "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_-10px_rgba(15,23,42,.45)] active:translate-y-0 active:scale-[.98]";

  return (
    <div className="flex items-center gap-2 border-b border-border bg-white px-3.5 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-signal/12 text-signal">
        <Bot size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {t("assistantTitle")}
          </span>
          <span className="hidden shrink-0 items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-dim sm:inline-flex">
            <CircleDot size={9} className="text-signal" />
            {t(isSidebar ? "assistantModeSidebar" : "assistantModeFloating")}
          </span>
        </div>
        <p className="truncate text-[10px] text-ink-dim">
          {t(tenderId ? "assistantHeaderWithTender" : "assistantHeaderNoTender")}
        </p>
      </div>
      <button
        type="button"
        onClick={newChat}
        title={t("assistantNewChat")}
        aria-label={t("assistantNewChat")}
        className={cn(
          ctaBtn,
          "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100",
        )}
      >
        <Plus size={13} />
        <span className="hidden sm:inline">{t("assistantNewChatShort")}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (!historyOpen) void refreshThreads();
          onToggleHistory();
        }}
        title={t("assistantHistory")}
        aria-label={t("assistantHistory")}
        className={cn(
          ctaBtn,
          historyOpen
            ? "border-sky-300 bg-sky-100 text-sky-800"
            : "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100",
        )}
      >
        <History size={13} />
        <span className="hidden sm:inline">{t("assistantHistoryShort")}</span>
      </button>
      {hasTurns && (
        <button
          type="button"
          onClick={clear}
          title={t("assistantClear")}
          aria-label={t("assistantClear")}
          className="grid h-7 w-7 place-items-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-100 active:translate-y-0 active:scale-[.98]"
        >
          <Trash2 size={14} />
        </button>
      )}
      <Link
        to={commandCenterTo}
        onClick={onClose}
        title={t("assistantCommandCenterHint")}
        aria-label={t("assistantCommandCenter")}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-1 text-[12px] font-medium text-ink-muted transition-all hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 active:translate-y-0"
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

function AssistantHistoryPanel() {
  const { t } = useApp();
  const {
    threads,
    threadsLoading,
    activeThreadId,
    refreshThreads,
    loadThread,
    newChat,
  } = useAssistantBridge();
  const [query, setQuery] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await refreshThreads(query);
  }

  return (
    <div className="border-b border-border bg-white px-3.5 py-3 shadow-[0_8px_22px_-22px_rgba(15,23,42,.35)]">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("assistantHistorySearchPlaceholder")}
            className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-2 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100 active:translate-y-0"
        >
          <Search size={12} />
          {t("assistantHistorySearch")}
        </button>
        <button
          type="button"
          onClick={() => void refreshThreads(query)}
          className="grid h-8 w-8 place-items-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-100 active:translate-y-0"
          title={t("assistantHistoryRefresh")}
          aria-label={t("assistantHistoryRefresh")}
        >
          <RefreshCw size={13} className={cn(threadsLoading && "animate-spin")} />
        </button>
      </form>

      <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1">
        {threadsLoading && threads.length === 0 ? (
          <p className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-[12px] text-ink-dim">
            {t("assistantHistoryLoading")}
          </p>
        ) : threads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-slate-50 px-3 py-3">
            <p className="text-[12px] font-medium text-ink">
              {t("assistantHistoryEmpty")}
            </p>
            <button
              type="button"
              onClick={newChat}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <Plus size={12} />
              {t("assistantNewChat")}
            </button>
          </div>
        ) : (
          threads.map((thread) => {
            const active = thread.id === activeThreadId;
            return (
              <button
                type="button"
                key={thread.id}
                onClick={() => void loadThread(thread.id)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-18px_rgba(15,23,42,.55)] active:translate-y-0",
                  active
                    ? "border-orange-200 bg-orange-50"
                    : "border-border bg-white hover:border-sky-200 hover:bg-sky-50",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                    active
                      ? "bg-orange-100 text-orange-700"
                      : "bg-slate-100 text-slate-600 group-hover:bg-sky-100 group-hover:text-sky-700",
                  )}
                >
                  <MessageSquareText size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink">
                    {thread.title || t("assistantUntitledThread")}
                  </span>
                  <span className="block truncate text-[10px] text-ink-dim">
                    {thread.scope === "assistant_page"
                      ? t("assistantHistoryScopePage")
                      : t("assistantHistoryScopePanel")}
                  </span>
                </span>
                <ChevronDown
                  size={13}
                  className="shrink-0 -rotate-90 text-ink-dim opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
