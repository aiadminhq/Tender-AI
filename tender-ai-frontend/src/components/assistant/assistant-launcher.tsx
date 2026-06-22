// 標案知識小助手：右下浮動入口 + sidebar／可拖曳縮放浮動視窗。
// 對話狀態/串流邏輯抽到 useAssistantChat（與整頁 /assistant 共用），
// 串列與輸入列分別由 AssistantThread / AssistantComposer 呈現。
// 行為埋點（scope=assistant）在 hook 內統一處理；此處只管開關與聚焦。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app-context";
import { AssistantWindow } from "./assistant-window";
import { AssistantThread } from "./assistant-thread";
import { AssistantComposer } from "./assistant-composer";
import { AssistantOnboarding } from "./assistant-onboarding";
import { useAssistantChat } from "./use-assistant-chat";
import { cn } from "@/lib/utils";

export function AssistantLauncher() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const {
    turns,
    draft,
    setDraft,
    streaming,
    send,
    clear,
    onSourceClick,
    suggestions,
    inputRef,
  } = useAssistantChat("assistant");

  // 開啟時聚焦輸入框；view 事件由 AssistantWindow 帶顯示模式送出。
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, inputRef]);

  return (
    <>
      <AssistantOnboarding onOpenAssistant={() => setOpen(true)} />

      {createPortal(
        <Button
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={t("assistantOpen")}
          title={t("assistantOpen")}
          className={cn(
            "fixed bottom-20 right-4 z-30 h-12 w-12 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,.06)] md:bottom-6 md:right-6",
            open && "pointer-events-none opacity-0",
          )}
        >
          <Bot size={20} />
        </Button>,
        document.body,
      )}

      <AssistantWindow
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            {t("assistantTitle")}
          </span>
        }
        footer={
          <AssistantComposer
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            streaming={streaming}
            showClear={turns.length > 0}
            onClear={clear}
            inputRef={inputRef}
          />
        }
      >
        <AssistantThread
          turns={turns}
          suggestions={suggestions}
          onSend={send}
          onSourceClick={onSourceClick}
        />
      </AssistantWindow>
    </>
  );
}
