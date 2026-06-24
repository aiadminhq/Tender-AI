// 標案詳情「常態性規格表」欄位顯示設定 client：對接後端 GET/PUT /settings/detail-fields。
// 這是團隊共用設定（單列 id=1，跨人共享，非個人偏好），決定詳情頁那張規格表要隱藏哪些欄位。
// 只存 UI 偏好（被隱藏的欄位鍵清單），不含 Layer A/B 內容，可入版控。
// 契約見 tender-ai-backend/app/schemas/settings.py。
//
// 設計重點：
//  - 自帶 API_BASE／authHeaders，不依賴 never-commit 的 api.ts。
//  - module-level store + useSyncExternalStore：跨元件共享隱藏集合，毋須掛 Provider（不動 App.tsx）。
//  - 後端連不到時優雅退化為「全部顯示」（空集合），不阻斷 UI。
import { useEffect, useSyncExternalStore } from "react";
import type { TextKey } from "@/i18n/strings";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1";

function authHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  return key ? { "X-API-Key": key } : {};
}

// —— 欄位註冊表 ——
// 標案詳情規格表「目前已擷取」的可切換欄位。key 為穩定識別碼（存進後端 hidden_fields），
// labelKey 重用既有 i18n key（不動 strings.ts）。順序＝規格表的呈現順序。
export interface DetailFieldDef {
  /** 穩定欄位鍵（存進後端 hidden_fields；勿隨意更名，會讓既存設定失準）。 */
  key: string;
  /** 既有 i18n TextKey（zh/en 已成對存在於 strings.ts）。 */
  labelKey: TextKey;
}

export const DETAIL_FIELDS: readonly DetailFieldDef[] = [
  { key: "performanceLocation", labelKey: "deliveryLocation" },
  { key: "performancePeriod", labelKey: "performancePeriod" },
  { key: "awardMethod", labelKey: "awardMethod" },
  { key: "deposit", labelKey: "deposit" },
  { key: "category", labelKey: "procurementCategory" },
  { key: "subsidySource", labelKey: "subsidySource" },
  { key: "qualification", labelKey: "qualification" },
  { key: "attachments", labelKey: "attachments" },
  { key: "extraNote", labelKey: "extraNote" },
] as const;

// —— 契約：對齊後端 DetailFieldVisibilityOut/Update（snake_case ↔ camelCase）——
export interface DetailFieldVisibility {
  hiddenFields: string[];
  updatedAt: string | null;
}

export interface DetailFieldVisibilityUpdate {
  hiddenFields?: string[];
}

interface DetailFieldVisibilityDto {
  hidden_fields: string[];
  updated_at: string | null;
}

function adapt(dto: DetailFieldVisibilityDto): DetailFieldVisibility {
  return {
    hiddenFields: Array.isArray(dto.hidden_fields) ? dto.hidden_fields : [],
    updatedAt: dto.updated_at ?? null,
  };
}

/** 讀取目前被隱藏的詳情欄位。 */
export async function fetchDetailFieldVisibility(
  signal?: AbortSignal,
): Promise<DetailFieldVisibility> {
  const res = await fetch(`${API_BASE}/settings/detail-fields`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`detail-fields API ${res.status}`);
  return adapt((await res.json()) as DetailFieldVisibilityDto);
}

/** 整批覆蓋被隱藏的詳情欄位（未送 hiddenFields 則後端不動）。回傳更新後的設定。 */
export async function updateDetailFieldVisibility(
  changes: DetailFieldVisibilityUpdate,
  signal?: AbortSignal,
): Promise<DetailFieldVisibility> {
  const body: Record<string, unknown> = {};
  if (changes.hiddenFields !== undefined)
    body.hidden_fields = changes.hiddenFields;
  const res = await fetch(`${API_BASE}/settings/detail-fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`detail-fields API ${res.status}`);
  return adapt((await res.json()) as DetailFieldVisibilityDto);
}

// —— module-level store（useSyncExternalStore）——
// 詳情頁規格表與設定頁卡片共享同一份隱藏集合；任一端更新，兩端同步。
let hiddenFields: ReadonlySet<string> = new Set();
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return hiddenFields;
}

function setHidden(next: Iterable<string>): void {
  hiddenFields = new Set(next);
  emit();
}

/** 首次使用時惰性向後端載入一次；失敗則退化為全部顯示（空集合），不再重試。 */
function ensureLoaded(): void {
  if (loaded || inFlight) return;
  inFlight = (async () => {
    try {
      const dto = await fetchDetailFieldVisibility();
      hiddenFields = new Set(dto.hiddenFields);
      emit();
    } catch {
      // 後端連不到（如預覽環境）：保持空集合＝全部顯示，優雅退化。
    } finally {
      loaded = true;
      inFlight = null;
    }
  })();
}

/** 讀取目前被隱藏的欄位集合（詳情規格表消費端）。後端不可用時為空集合（全部顯示）。 */
export function useHiddenDetailFields(): ReadonlySet<string> {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    ensureLoaded();
  }, []);
  return hidden;
}

/** 整批覆蓋隱藏集合：先樂觀更新本地、再寫後端；失敗回滾並丟出錯誤。 */
export async function saveHiddenDetailFields(
  next: Iterable<string>,
  signal?: AbortSignal,
): Promise<DetailFieldVisibility> {
  const prev = hiddenFields;
  const nextSet = new Set(next);
  setHidden(nextSet); // 樂觀更新
  try {
    const dto = await updateDetailFieldVisibility(
      { hiddenFields: [...nextSet] },
      signal,
    );
    setHidden(dto.hiddenFields); // 以後端正規化結果為準
    loaded = true;
    return dto;
  } catch (e) {
    setHidden(prev); // 回滾
    throw e;
  }
}
