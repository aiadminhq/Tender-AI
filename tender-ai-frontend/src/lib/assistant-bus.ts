// 小助手「外部請求匯流排」：讓非小助手樹內的元件（如全局選區選單）能請求開啟浮窗
// 並送出一則提問。模組層級的 EventTarget，無需共用 React context；AssistantLauncher
// 訂閱後負責開窗＋呼叫 runtime send。payload 為已組好的完整提問字串。
export interface AssistantRequest {
  /** 已組好的完整提問（含選取文字與來源／欄位脈絡）。 */
  prompt: string;
}

const target = new EventTarget();
const EVENT = "assistant:ask";

/** 請求小助手回答一則提問（會開啟浮窗並送出）。供選區選單等外部入口呼叫。 */
export function requestAssistant(prompt: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  target.dispatchEvent(
    new CustomEvent<AssistantRequest>(EVENT, { detail: { prompt: trimmed } }),
  );
}

/** 訂閱外部提問請求；回傳取消訂閱函式。 */
export function onAssistantRequest(
  cb: (req: AssistantRequest) => void,
): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<AssistantRequest>).detail);
  target.addEventListener(EVENT, handler);
  return () => target.removeEventListener(EVENT, handler);
}
