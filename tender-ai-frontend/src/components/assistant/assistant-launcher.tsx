// 標案知識小助手入口：非阻擋式浮窗（@assistant-ui AssistantModalPrimitive，無遮罩、不鎖背景）。
// 對話狀態/串流由 <AssistantRuntime> 橋接到後端（與整頁 /assistant 指揮中心共用同套 runtime）；
// 此處只管開關與「在哪個標案頁」的情境（tenderId → 指揮中心入口帶 ?tender=<id>）。
// 首次聚光導覽 AssistantOnboarding 仍掛在這層，可主動開啟浮窗。
// 另監聽全局選區選單的「傳送給 AI」請求（assistant-bus）：開窗並送出該則提問。
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useMatch } from "react-router-dom";
import { onAssistantRequest } from "@/lib/assistant-bus";
import { AssistantRuntime } from "./assistant-runtime-provider";
import { useAssistantBridge } from "./assistant-bridge";
import { AssistantModal } from "./assistant-modal";
import { AssistantOnboarding } from "./assistant-onboarding";

export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const tenderMatch = useMatch("/tenders/:id");
  const tenderId = tenderMatch?.params.id ?? null;

  return (
    <AssistantRuntime scope="assistant" focusTenderId={tenderId}>
      <AssistantOnboarding onOpenAssistant={() => setOpen(true)} />
      <AssistantBusListener setOpen={setOpen} />
      <AssistantModal open={open} onOpenChange={setOpen} tenderId={tenderId} />
    </AssistantRuntime>
  );
}

// 訂閱外部提問請求（選區選單「傳送給 AI」）：開窗並送出。須在 AssistantRuntime 內才有 send。
function AssistantBusListener({
  setOpen,
}: {
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const { send } = useAssistantBridge();
  useEffect(
    () =>
      onAssistantRequest(({ prompt }) => {
        setOpen(true);
        send(prompt);
      }),
    [setOpen, send],
  );
  return null;
}
