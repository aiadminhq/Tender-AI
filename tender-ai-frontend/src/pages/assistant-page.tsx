// 指揮中心 /assistant：小助手浮窗的「整頁版」工作台——左對話、右情境工作區。
// 與浮窗共用同一套 @assistant-ui runtime（AssistantRuntime）與 Thread 元件（AssistantUIThread）；
// 右欄 AssistantContextPanel 依網址 ?tender=<id> 帶出當前標案（概況/可行性/相似案/快速動作）。
// 獨立路由、永不覆蓋主畫面、零遮罩。行為埋點：進頁 view(scope=assistant_page)。
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { AssistantRuntime } from "@/components/assistant/assistant-runtime-provider";
import { AssistantUIThread } from "@/components/assistant/assistant-ui-thread";
import { AssistantContextPanel } from "@/components/assistant/assistant-context-panel";
import { trackEvent } from "@/lib/events";

export function AssistantPage() {
  const { t } = useApp();
  const [params] = useSearchParams();
  const tenderId = params.get("tender");

  useEffect(() => {
    trackEvent("view", { payload: { scope: "assistant_page" } });
  }, []);

  return (
    <div className="flex flex-col space-y-5">
      <PageHeader title={t("navAssistant")} subtitle={t("assistantPageSub")} />

      {/* 有界高度的指揮中心：左對話自捲、右情境工作區自捲；窄螢幕僅顯示對話。 */}
      <AssistantRuntime scope="assistant_page" focusTenderId={tenderId}>
        <div className="grid h-[calc(100svh-13rem)] min-h-[460px] grid-cols-1 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
          <div className="flex min-h-0 flex-col lg:border-r lg:border-border">
            <AssistantUIThread />
          </div>
          <aside className="hidden min-h-0 flex-col overflow-y-auto bg-canvas/40 lg:flex">
            <AssistantContextPanel tenderId={tenderId} />
          </aside>
        </div>
      </AssistantRuntime>
    </div>
  );
}
