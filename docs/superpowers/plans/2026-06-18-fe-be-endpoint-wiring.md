# 前端串接後端剩餘端點 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端尚未串接的後端端點接上——列表分頁（讓全部 1125 筆可見，現僅 200 筆）與 saved-searches（GET/POST 完全未接），使前後端整合完整可運轉。

**Architecture:** 沿用既有 `src/lib/api.ts` 適配層（後端 snake_case → 前端 domain camelCase）。分頁在 `fetchTenders` 內逐頁累積至 `count`。saved-searches 以 localStorage 為前端真相來源（符合 Layer B 鐵則），掛載時若 live 再 GET 後端合併、儲存時 fire-and-forget POST 鏡射；UI 落在既有 FilterBar 右側區。

**Tech Stack:** React 19 + Vite 8 + TypeScript 6 + Tailwind 4；測試 vitest（環境 `node`，僅收 `src/**/*.test.ts`）；套件管理 **pnpm**。

## Global Constraints

- 套件管理一律用 **pnpm**：型別檢查／建置 `pnpm run build`（= `tsc -b && vite build`）；測試 `pnpm run test`（= `vitest run`）或 `pnpm exec vitest run <file>`。**不要用 npm。**
- 後端 base 預設 `http://localhost:8000/api/v1`，由 `API_BASE`（`import.meta.env.VITE_API_BASE` ?? 預設）提供，端點路徑一律相對此 base 串接。
- `VITE_USE_API === "false"`（純 mock 模式）時**不可對外發任何請求**——所有新增的對外函式都必須在此模式下提前 return。
- API 金鑰僅由環境注入（`VITE_API_KEY` → `X-API-Key`），**永不寫入版控**；一律透過既有 `authHeaders()` 帶上。
- Layer B 鐵則：行為／偏好寫入**一律省略 `user_id`**（後端落到預設使用者，不送 PII）；localStorage 是前端真相來源；後端失敗靜默、不阻塞 UI、不回滾。
- i18n `src/i18n/strings.ts` 的 `zh`／`en` 必須**成對**新增 key，否則 `TextKey` 型別編譯失敗。
- 不動 tier `priority` 級（後端 4 級 priority/high/mid/low vs 前端 3 級，跨 domain/api/badge 契約變更，已由前一計畫列為後續獨立 ticket）；本計畫不處理 source TPC/NPC 與 user_state.status enum 對映落差（非「未接端點」，超出本次範圍）。
- `GET /search/semantic` 後端被 Ollama 缺 `bge-m3` 模型阻擋，**本計畫排除**，不新增其前端串接。

---

### Task 1: 列表分頁——`fetchTenders` 逐頁抓全部

後端 `GET /api/v1/tenders` 支援 `page`（≥1）與 `page_size`（1..200），回傳 `{ items, count, page, page_size }`。現況 `fetchTenders` 僅抓 `page_size=200` 單頁，1125 筆只看得到 200 筆。改為逐頁累積至 `count`。

**Files:**

- Modify: `src/lib/api.ts:150-157`（`fetchTenders`）
- Test: `src/lib/api.test.ts`（新建）

**Interfaces:**

- Consumes: 既有 `API_BASE`、`authHeaders()`、`adapt()`、interface `TenderListItem` / `TenderListResponse`（皆已存在於 `src/lib/api.ts`）。
- Produces: `export async function fetchTenders(signal?: AbortSignal): Promise<Tender[]>`（簽章不變，行為改為抓全部頁）。

- [ ] **Step 1: 寫失敗測試**

新建 `src/lib/api.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTenders } from "@/lib/api";

function makeItem(id: number) {
  return {
    id,
    source: "PCC",
    case_pk: null,
    name: `案 ${id}`,
    org: null,
    category: null,
    budget_wan: null,
    deadline_roc: null,
    deadline_iso: null,
    tender_method: null,
    city: null,
    link: null,
    tier: "mid",
    days_left: null,
    first_seen: null,
    last_seen: null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchTenders 分頁", () => {
  it("逐頁抓取直到取得全部 count 筆", async () => {
    const total = 450; // 200 + 200 + 50 → 3 頁
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("page"));
      const size = 200;
      const start = (page - 1) * size;
      const items = Array.from(
        { length: Math.max(0, Math.min(size, total - start)) },
        (_, i) => makeItem(start + i + 1),
      );
      return {
        ok: true,
        json: async () => ({ items, count: total, page, page_size: size }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTenders();
    expect(result).toHaveLength(total);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("空頁時中止，避免無限迴圈", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            items: [],
            count: 999,
            page: 1,
            page_size: 200,
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTenders();
    expect(result).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run src/lib/api.test.ts`
Expected: FAIL（現況單頁只回 200 筆 + 只呼叫 1 次 fetch，第一個案例斷言 450/3 次失敗）。

- [ ] **Step 3: 改寫 `fetchTenders` 為逐頁累積**

把 `src/lib/api.ts:150-157` 整段替換為：

```ts
const PAGE_SIZE = 200; // 後端 page_size 上限

/** 抓取標案列表並映射為前端 Tender[]；逐頁抓到 count 為止。失敗時 throw。 */
export async function fetchTenders(signal?: AbortSignal): Promise<Tender[]> {
  const items: TenderListItem[] = [];
  let page = 1;
  for (;;) {
    const url = `${API_BASE}/tenders?sort=feas&page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: authHeaders(), signal });
    if (!res.ok) throw new Error(`tenders API ${res.status}`);
    const data = (await res.json()) as TenderListResponse;
    items.push(...data.items);
    // 取滿總數或遇到空頁即停（後者防呆，避免 count 與實際不一致時無限迴圈）。
    if (items.length >= data.count || data.items.length === 0) break;
    page += 1;
  }
  return items.map(adapt);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run src/lib/api.test.ts`
Expected: PASS（2 案例皆綠）。

- [ ] **Step 5: 型別／建置檢查**

Run: `pnpm run build`
Expected: 編譯通過。

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat: 列表逐頁抓取，讓全部標案可見（取代單頁 200 筆上限）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: saved-searches API client + domain 型別

後端（behavior router，掛在 `/api/v1` 下，無額外 prefix）：

- `GET /api/v1/saved-searches?user_id=` → `SavedSearchOut[]`，`SavedSearchOut = { id, user_id, name, query_text, filter_json, created_at }`。`user_id` 省略時讀預設使用者、且唯讀不建立使用者。
- `POST /api/v1/saved-searches` body `SavedSearchCreate = { user_id?, name (min_length 1), query_text?, filter_json? (dict) }` → 回 `SavedSearchOut`。省略 `user_id` 時後端落到預設使用者。

依 Layer B 鐵則一律省略 `user_id`。

**Files:**

- Modify: `src/types/domain.ts`（檔尾新增 `SavedSearch` 介面）
- Modify: `src/lib/api.ts`（檔尾新增 client 函式與後端介面）
- Test: `src/lib/api.test.ts`（沿用 Task 1 檔，新增 describe 區塊）

**Interfaces:**

- Consumes: 既有 `API_BASE`、`authHeaders()`；`FilterState`（`@/types/domain`）。
- Produces:
  - `export interface SavedSearch { id: number; name: string; filter: FilterState }`（於 `domain.ts`）
  - `export async function fetchSavedSearches(signal?: AbortSignal): Promise<SavedSearch[]>`
  - `export async function postSavedSearch(name: string, filter: FilterState): Promise<SavedSearch | null>`

- [ ] **Step 1: 在 `domain.ts` 新增 `SavedSearch` 型別**

`src/types/domain.ts` 檔尾新增（`FilterState` 已定義於同檔，可直接引用）：

```ts
/** 已儲存的篩選預設（saved-searches）；filter 存整份 FilterState 以便完整套用。 */
export interface SavedSearch {
  id: number;
  name: string;
  filter: FilterState;
}
```

- [ ] **Step 2: 寫失敗測試**

在 `src/lib/api.test.ts` 檔尾、`afterEach` 之後新增（import 行併到檔頭既有 import）：

把檔頭 import 改為：

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTenders, fetchSavedSearches, postSavedSearch } from "@/lib/api";
import type { FilterState } from "@/types/domain";
```

檔尾新增：

```ts
const FILTER: FilterState = {
  query: "醫院",
  sources: ["PCC"],
  tiers: ["high"],
  maxBudget: null,
  focusOnly: false,
  hideExcluded: true,
  sort: "score",
  categories: [],
  orgKeyword: "",
  deadlineFrom: null,
  deadlineTo: null,
  tagFilter: [],
  northOnly: false,
  newToday: false,
};

describe("saved-searches client", () => {
  it("GET 映射 query_text/filter_json → SavedSearch", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => [
            {
              id: 7,
              user_id: 1,
              name: "北部醫院",
              query_text: "醫院",
              filter_json: FILTER,
              created_at: "2026-06-18T00:00:00Z",
            },
          ],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const list = await fetchSavedSearches();
    expect(list).toEqual([{ id: 7, name: "北部醫院", filter: FILTER }]);
  });

  it("POST 送出 name/query_text/filter_json 並回映射結果", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        name: "北部醫院",
        query_text: "醫院",
        filter_json: FILTER,
      });
      return {
        ok: true,
        json: async () => ({
          id: 9,
          user_id: 1,
          name: "北部醫院",
          query_text: "醫院",
          filter_json: FILTER,
          created_at: "2026-06-18T00:00:00Z",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const row = await postSavedSearch("北部醫院", FILTER);
    expect(row).toEqual({ id: 9, name: "北部醫院", filter: FILTER });
  });

  it("純 mock 模式（VITE_USE_API=false）不外連", async () => {
    vi.stubEnv("VITE_USE_API", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSavedSearches()).toEqual([]);
    expect(await postSavedSearch("x", FILTER)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `pnpm exec vitest run src/lib/api.test.ts`
Expected: FAIL with "fetchSavedSearches is not a function"（或 import 解析錯誤）。

- [ ] **Step 4: 實作 client 函式**

在 `src/lib/api.ts` 檔尾新增（`FilterState` 加到檔頭既有 `import type` 區塊）：

把檔頭的 domain import 改為含 `FilterState`、`SavedSearch`：

```ts
import type {
  Category,
  FilterState,
  SavedSearch,
  SourceKey,
  Tender,
  TenderDetail,
  Tier,
} from "@/types/domain";
```

檔尾新增：

```ts
// ── saved-searches（篩選預設；非 fire-and-forget，UI 需要回傳資料） ──────
// 後端 app/api/v1/behavior.py，掛在 /api/v1 下。依 Layer B 省略 user_id。
interface SavedSearchOut {
  id: number;
  user_id: number;
  name: string;
  query_text: string | null;
  filter_json: FilterState | null;
  created_at: string;
}

function adaptSavedSearch(o: SavedSearchOut): SavedSearch {
  return {
    id: o.id,
    name: o.name,
    // filter_json 由前端自家寫入，型別即 FilterState；缺值給空查詢防呆。
    filter: o.filter_json ?? ({} as FilterState),
  };
}

/** 讀取雲端篩選預設（GET /saved-searches）。純 mock 模式回 []；失敗時 throw。 */
export async function fetchSavedSearches(
  signal?: AbortSignal,
): Promise<SavedSearch[]> {
  if (import.meta.env.VITE_USE_API === "false") return [];
  const res = await fetch(`${API_BASE}/saved-searches`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`saved-searches API ${res.status}`);
  const data = (await res.json()) as SavedSearchOut[];
  return data.map(adaptSavedSearch);
}

/** 建立篩選預設（POST /saved-searches）。純 mock 模式回 null；失敗時 throw。 */
export async function postSavedSearch(
  name: string,
  filter: FilterState,
): Promise<SavedSearch | null> {
  if (import.meta.env.VITE_USE_API === "false") return null;
  const res = await fetch(`${API_BASE}/saved-searches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      name,
      query_text: filter.query || null,
      filter_json: filter,
    }),
  });
  if (!res.ok) throw new Error(`saved-searches API ${res.status}`);
  return adaptSavedSearch((await res.json()) as SavedSearchOut);
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `pnpm exec vitest run src/lib/api.test.ts`
Expected: PASS（含 Task 1 共 5 案例皆綠）。

- [ ] **Step 6: 型別／建置檢查**

Run: `pnpm run build`
Expected: 編譯通過。

- [ ] **Step 7: Commit**

```bash
git add src/types/domain.ts src/lib/api.ts src/lib/api.test.ts
git commit -m "feat: 新增 saved-searches API client（GET/POST + SavedSearch 型別）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: app-data store 整合 saved-searches

以 localStorage（key `savedSearches`）為前端真相來源；掛載時若 live 再 GET 後端依 name 合併（雲端優先）；儲存時寫 localStorage + fire-and-forget POST 鏡射，成功後以後端真實 id 取代暫時 id。

**Files:**

- Modify: `src/store/app-data.tsx`

**Interfaces:**

- Consumes: Task 2 的 `fetchSavedSearches` / `postSavedSearch`；`SavedSearch`（`@/types/domain`）；既有 `load` / `save`（`@/lib/storage`）、`filter` state、`setFilter`。
- Produces（加進 `AppDataValue` 並由 `useAppData()` 提供）:
  - `savedSearches: SavedSearch[]`
  - `saveCurrentSearch: (name: string) => void`
  - `applySavedSearch: (id: number) => void`

- [ ] **Step 1: 補 import**

確認 `src/store/app-data.tsx` 檔頭：

- 從 `@/lib/api` 的既有 import 加入 `fetchSavedSearches`、`postSavedSearch`。
- 從 `@/types/domain` 的既有 import 加入 `SavedSearch`。
- 確認 `load`、`save` 已從 `@/lib/storage` import（既有），若無則補上。

- [ ] **Step 2: `AppDataValue` 介面新增三個成員**

在 `src/store/app-data.tsx` 的 `interface AppDataValue`（約 110-153 行）內、`resetFilter` 之後加入：

```ts
  // 篩選預設（saved-searches）
  savedSearches: SavedSearch[];
  saveCurrentSearch: (name: string) => void;
  applySavedSearch: (id: number) => void;
```

- [ ] **Step 3: state + 掛載合併 + 兩個 action**

在 `AppDataProvider` 內、`setFilter`/`resetFilter` 定義之後加入：

```ts
// 篩選預設：localStorage 為真相來源；live 時掛載合併雲端（同名以雲端為準）。
const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() =>
  load<SavedSearch[]>("savedSearches", []),
);

useEffect(() => {
  if (import.meta.env.VITE_USE_API === "false") return;
  const ac = new AbortController();
  fetchSavedSearches(ac.signal)
    .then((remote) => {
      if (!remote.length) return;
      setSavedSearches((local) => {
        const byName = new Map<string, SavedSearch>();
        for (const s of local) byName.set(s.name, s);
        for (const s of remote) byName.set(s.name, s); // 雲端覆蓋同名
        const merged = [...byName.values()];
        save("savedSearches", merged);
        return merged;
      });
    })
    .catch(() => {
      /* 雲端讀取失敗：維持 localStorage，不影響 UI */
    });
  return () => ac.abort();
}, []);

const saveCurrentSearch = useCallback(
  (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry: SavedSearch = { id: Date.now(), name: trimmed, filter };
    setSavedSearches((prev) => {
      const next = [...prev.filter((s) => s.name !== trimmed), entry];
      save("savedSearches", next);
      return next;
    });
    // 鏡射到後端（best-effort）；成功則以真實 id 取代暫時 id。
    void postSavedSearch(trimmed, filter)
      .then((row) => {
        if (!row) return;
        setSavedSearches((prev) => {
          const next = prev.map((s) =>
            s.name === trimmed ? { ...s, id: row.id } : s,
          );
          save("savedSearches", next);
          return next;
        });
      })
      .catch(() => {
        /* 後端鏡射失敗：localStorage 已存，UI 不受影響 */
      });
  },
  [filter],
);

const applySavedSearch = useCallback(
  (id: number) => {
    const found = savedSearches.find((s) => s.id === id);
    // filter 存整份 FilterState，setFilter 以 patch 覆蓋全鍵 → 等同完整套用。
    if (found) setFilter(found.filter);
  },
  [savedSearches, setFilter],
);
```

> 注意：`setFilter` 簽章為 `(patch: Partial<FilterState>) => void` 且對當前 state 做合併；由於 `found.filter` 含全部鍵，覆蓋後等同完整套用該預設。

- [ ] **Step 4: 併入 context value**

在 `AppDataProvider` 回傳的 value `useMemo`（含 `setFilter`/`resetFilter` 的物件，約 628-662 行）內加入 `savedSearches`、`saveCurrentSearch`、`applySavedSearch`，並把這三者加進該 `useMemo` 的依賴陣列。

- [ ] **Step 5: 型別／建置檢查**

Run: `pnpm run build`
Expected: 編譯通過（無未使用變數、依賴陣列完整）。

- [ ] **Step 6: 跑既有測試確認無退步**

Run: `pnpm run test`
Expected: 全綠（既有測試 + Task 1/2 新增）。

- [ ] **Step 7: Commit**

```bash
git add src/store/app-data.tsx
git commit -m "feat: app-data 整合 saved-searches（localStorage 真相來源 + 雲端合併/鏡射）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: FilterBar saved-searches UI + i18n

在 FilterBar 右側區（排序旁、分享鈕之前）加「儲存目前篩選」鈕與「套用預設」下拉。

**Files:**

- Modify: `src/i18n/strings.ts`（zh/en 成對新增 key）
- Modify: `src/components/tenders/filter-bar.tsx`

**Interfaces:**

- Consumes: Task 3 的 `savedSearches` / `saveCurrentSearch` / `applySavedSearch`（`useAppData()`）；既有 `Button`、lucide 圖示。
- Produces: 無新 export。

- [ ] **Step 1: i18n 新增 key（zh/en 成對）**

在 `src/i18n/strings.ts` 的 `zh` 區塊（找一個合適分區，如排序/篩選附近）新增：

```ts
    savedSearches: "篩選預設",
    saveSearch: "儲存目前篩選",
    saveSearchPrompt: "為這組篩選命名：",
```

在 `en` 區塊對應位置新增（必須成對，否則 `TextKey` 編譯失敗）：

```ts
    savedSearches: "Saved searches",
    saveSearch: "Save current filter",
    saveSearchPrompt: "Name this filter set:",
```

- [ ] **Step 2: FilterBar 取用 store 與圖示**

`src/components/tenders/filter-bar.tsx`：

- 第 2 行 lucide import 加入 `Save`：`import { Eye, EyeOff, Target, X, Link2, Save } from "lucide-react";`
- 第 74 行 `useAppData()` 解構加入三個成員：

```ts
const {
  filter,
  setFilter,
  resetFilter,
  tenders,
  savedSearches,
  saveCurrentSearch,
  applySavedSearch,
} = useAppData();
```

- [ ] **Step 3: 右側區插入 UI**

在 `src/components/tenders/filter-bar.tsx` 右側區塊內、排序 `<select>` 之後、分享 `<Button>`（`title={t("shareFilter")}`）之前插入：

```tsx
{
  savedSearches.length > 0 && (
    <select
      value=""
      onChange={(e) => {
        const id = Number(e.target.value);
        if (id) applySavedSearch(id);
      }}
      aria-label={t("savedSearches")}
      className="h-9 cursor-pointer rounded-md border border-input bg-surface-1 px-2.5 text-[12px] text-ink outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
    >
      <option value="">{t("savedSearches")}</option>
      {savedSearches.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
<Button
  variant="ghost"
  size="sm"
  title={t("saveSearch")}
  onClick={() => {
    const name = window.prompt(t("saveSearchPrompt"));
    if (name) saveCurrentSearch(name);
  }}
>
  <Save size={14} />
</Button>;
```

- [ ] **Step 4: 型別／建置檢查**

Run: `pnpm run build`
Expected: 編譯通過（i18n 成對、無未使用 import）。

- [ ] **Step 5: Commit**

```bash
git add src/i18n/strings.ts src/components/tenders/filter-bar.tsx
git commit -m "feat: FilterBar 加入 saved-searches 儲存/套用 UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 端到端驗證（Preview MCP）

**Files:** 無（驗證用）

- [ ] **Step 1: 啟動／reload preview**

Preview MCP（serverId `tender-ai-dev`，port 5173）：`preview_start`（或既有則 reload）。
Run check: `preview_console_logs` → 無 error。

- [ ] **Step 2: 驗證分頁**

`preview_snapshot` 確認標案清單載入筆數 > 200（後端 live 約 1125 筆；若後端未啟動則 fallback mock，需在後端啟動下驗）。必要時 `preview_eval` 取列表長度佐證。

- [ ] **Step 3: 驗證 saved-searches**

`preview_fill`/`preview_click` 設定一組篩選 → 點「儲存目前篩選」鈕 → 輸入名稱 → 下拉出現該預設 → 改動篩選後從下拉套用 → `preview_snapshot` 確認篩選還原。

- [ ] **Step 4: 截圖佐證**

`preview_screenshot` 收尾。

- [ ] **Step 5: 記錄驗證結果於 ledger**（由 SDD 流程處理，無需 commit）

---

## 範圍備註（明確排除）

- `GET /search/semantic`：後端 Ollama 缺 `bge-m3` 模型，端點不可用 → 排除，待後端補模型後另開 ticket。
- tier `priority` 級（後端 4 級 vs 前端 3 級）：跨 domain/api/badge 契約變更，前一計畫已列後續獨立 ticket。
- source `TPC`/`NPC`（前端有、後端僅 PCC/TMU）與 `user_state.status` enum（觀望/備標中/已投/得標/放棄）對 Kanban 的對映：屬資料契約落差，非「未接端點」，超出本次「串接剩餘端點」範圍。
