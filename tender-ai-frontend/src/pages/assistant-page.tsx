// 小助手工作頁 /assistant：浮窗 AssistantLauncher 的「整頁版」。
// 共用 useAssistantChat + AssistantThread + AssistantComposer。
// <main> 採自然捲動（非固定高度容器），故此頁自帶一個有界高度、可自捲的對話卡。
// 行為埋點：進頁=view(scope=assistant_page)、提問/點來源 scope 由 hook 帶 assistant_page。
import { useEffect } from "react";
import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { AssistantThread } from "@/components/assistant/assistant-thread";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { useAssistantChat } from "@/components/assistant/use-assistant-chat";
import { trackEvent } from "@/lib/events";

export function AssistantPage() {
  const { t } = useApp();
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
  } = useAssistantChat("assistant_page");

  useEffect(() => {
    trackEvent("view", { payload: { scope: "assistant_page" } });
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [inputRef]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col space-y-5">
      <PageHeader title={t("navAssistant")} subtitle={t("assistantPageSub")} />

      {/* 有界高度的對話卡：內部 thread 區自捲，composer 固定底部。 */}
      <div className="flex h-[calc(100svh-13rem)] min-h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <AssistantThread
            turns={turns}
            suggestions={suggestions}
            onSend={send}
            onSourceClick={onSourceClick}
          />
        </div>
        <div className="border-t border-border px-4 py-3">
          <AssistantComposer
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            streaming={streaming}
            showClear={turns.length > 0}
            onClear={clear}
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}
