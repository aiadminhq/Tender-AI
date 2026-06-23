// 非阻擋式小助手浮窗：以 @assistant-ui 的 AssistantModalPrimitive（Radix Popover 底層、
// modal=false → 無遮罩、不鎖背景）搭出右下角 FAB ＋ 彈出對話框。改造重點：
//   1. 全程無半透明遮罩，主畫面照常可操作；點外面不自動關閉（dissmissOnInteractOutside=false），
//      由 FAB 或關閉鈕收合。
//   2. 房屋風格 tokens（bg-popover / border-border / rounded-2xl / 輕陰影 / animate-in）。
//   3. 標題列「指揮中心」入口 → 導去 /assistant 全頁工作台（在標案頁時帶 ?tender=<id>），不覆蓋主畫面。
// 內容即為共用的 AssistantUIThread；對話狀態由外層 <AssistantRuntime> 提供。
import { forwardRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Bot, ChevronDown, PanelsTopLeft, Trash2, X } from "lucide-react";
import { AssistantModalPrimitive } from "@assistant-ui/react";
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

export function AssistantModal({
  open,
  onOpenChange,
  tenderId,
}: AssistantModalProps) {
  return (
    <AssistantModalPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      unstable_openOnRunStart={false}
    >
      {/* Anchor＋FAB 以 portal 送到 body：launcher 掛在 sticky topbar 內，header（h-14）
          成了 fixed 定位的包含塊，會把 bottom-6 黏在 header 底（top≈-17px 跑出畫面）。
          送到 body 後 fixed 才對齊 viewport；Radix context 穿透 portal，Content 定位仍以 Anchor rect 為準。 */}
      {createPortal(
        <AssistantModalPrimitive.Anchor className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6">
          <AssistantModalPrimitive.Trigger asChild>
            <FabButton />
          </AssistantModalPrimitive.Trigger>
        </AssistantModalPrimitive.Anchor>,
        document.body,
      )}

      <AssistantModalPrimitive.Content
        side="top"
        align="end"
        sideOffset={14}
        dissmissOnInteractOutside={false}
        className={cn(
          "z-40 flex h-[min(560px,calc(100svh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden",
          "rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
        )}
      >
        <ModalHeader tenderId={tenderId} onClose={() => onOpenChange(false)} />
        <div className="min-h-0 flex-1">
          <AssistantUIThread />
        </div>
      </AssistantModalPrimitive.Content>
    </AssistantModalPrimitive.Root>
  );
}

// FAB：開啟時 Bot 縮小淡出、ChevronDown 浮現（提示「收合」），純 CSS 依 data-state 切換。
const FabButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button">
>(function FabButton(props, ref) {
  const { t } = useApp();
  return (
    <button
      {...props}
      ref={ref}
      aria-label={t("assistantOpen")}
      title={t("assistantOpen")}
      className="group relative grid h-14 w-14 place-items-center rounded-2xl bg-signal text-white outline-none shadow-[0_8px_24px_-8px_var(--signal-ring),0_2px_8px_-3px_rgba(0,0,0,.18)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-10px_var(--signal-ring),0_4px_12px_-4px_rgba(0,0,0,.2)] active:translate-y-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <Bot
        size={23}
        className="absolute transition-all data-[state=open]:scale-0 group-data-[state=open]:rotate-90 group-data-[state=open]:scale-0 group-data-[state=open]:opacity-0"
      />
      <ChevronDown
        size={24}
        className="absolute scale-0 rotate-[-90deg] opacity-0 transition-all group-data-[state=open]:scale-100 group-data-[state=open]:rotate-0 group-data-[state=open]:opacity-100"
      />
    </button>
  );
});

function ModalHeader({
  tenderId,
  onClose,
}: {
  tenderId: string | null;
  onClose: () => void;
}) {
  const { t } = useApp();
  const { clear, hasTurns } = useAssistantBridge();
  const commandCenterTo = tenderId
    ? `/assistant?tender=${tenderId}`
    : "/assistant";

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
          onClick={clear}
          title={t("assistantClear")}
          aria-label={t("assistantClear")}
          className="grid h-7 w-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-accent hover:text-foreground"
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
      <button
        onClick={onClose}
        title={t("close")}
        aria-label={t("close")}
        className="grid h-7 w-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={15} />
      </button>
    </div>
  );
}
