// 使用者行為埋點：fire-and-forget 送到後端 POST /events。
// 沿用 api.ts 的 API_BASE。不阻塞 UI、catch 吞錯（比照 fetchTenders 容錯）。
// VITE_USE_API === "false" 全 mock 不打 API；VITE_TRACK === "false" 可單獨關埋點。

// api.ts 未 export API_BASE，比照其定義一份。
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1";

// 對齊後端 EventRequest.type（app/schemas）。
// 註：kanban 註記／轉傳三類為前端先行（Layer B 行為訊號），後端 EventRequest.type
//     enum 尚未涵蓋；trackEvent 為 fire-and-forget 且靜默吞錯，後端未支援時不影響 UI。
//     待後端同步擴充 enum 後即可入庫（見 plans/uiux-v2-plan.md N2 後續）。
export type EventType =
  | "view"
  | "open_detail"
  | "click_link"
  | "dwell"
  | "apply_filter"
  | "search"
  | "sort"
  | "card_note_added"
  | "card_note_removed"
  | "card_forwarded";

interface TrackOptions {
  tenderId?: string;
  payload?: Record<string, unknown>;
}

function trackingEnabled(): boolean {
  if (import.meta.env.VITE_USE_API === "false") return false;
  if (import.meta.env.VITE_TRACK === "false") return false;
  return true;
}

/**
 * 送出一筆行為事件到 POST /events（fire-and-forget）。
 * - 不帶 user_id：現行 demo 尚未建登入，後端自動取／建立預設使用者（目標：白名單登入後帶 user_id 具名，見 CLAUDE.md）。
 * - tenderId 字串 → Number；NaN 則省略 tender_id（apply_filter/search/sort 不帶）。
 * - 失敗（後端未啟動／網路錯誤）一律靜默吞錯，不影響 UI。
 */
export function trackEvent(type: EventType, opts: TrackOptions = {}): void {
  if (!trackingEnabled()) return;

  const body: {
    type: EventType;
    tender_id?: number;
    payload?: Record<string, unknown>;
  } = { type };

  if (opts.tenderId != null) {
    const n = Number(opts.tenderId);
    if (!Number.isNaN(n)) body.tender_id = n;
  }
  if (opts.payload) body.payload = opts.payload;

  try {
    void fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true, // 卸載時（dwell）仍能送達
    }).catch(() => {
      /* 後端未啟動／錯誤：埋點不重試、不影響 UI */
    });
  } catch {
    /* fetch 同步拋錯（極少）也吞掉 */
  }
}
