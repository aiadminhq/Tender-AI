// 滑卡頁的行為訊號（Layer B）：集中於此，沿用既有 trackEvent 埋點。
//
// 鐵則：events.ts 的 EventType 是封閉聯集，不可新增型別。故滑動方向不另立
// 事件類型，而是復用既有型別、把方向放進 payload.scope 標記：
//   - peek（點擊看詳情）  → click_link（與「點開連結看內容」語義一致）
//   - accept / pass / save → view（瀏覽過卡片時的傾向訊號）
//
// 另一鐵則：左滑＝略過「只發訊號、不呼叫 store.skip()、不刪除或隱藏標案」。
// 本檔只負責送訊號；是否改動 store 由呼叫端（swipe-page）依方向決定。
import { trackEvent } from "@/lib/events";

export type SwipeAction = "accept" | "pass" | "save" | "peek";

/**
 * 送出一筆滑卡行為訊號（fire-and-forget）。
 * payload.scope="swipe" 讓後端可把滑卡來源與一般列表瀏覽區分開來做學習。
 */
export function trackSwipe(action: SwipeAction, tenderId: string): void {
  const type = action === "peek" ? "click_link" : "view";
  trackEvent(type, { tenderId, payload: { scope: "swipe", action } });
}
