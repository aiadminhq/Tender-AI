# Knowvio 儀表板 mock→live 接線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/knowvio` 戰情儀表板頁面中五處寫死的裝飾 mock（趨勢圖、活動甜甜圈、KPI 變化徽章、截止表狀態、歡迎副標）換成 `useAppData()` 已暴露的真實聚合，純前端、零新後端。

**Architecture:** 先把「會產生分歧、值得測」的彙總邏輯抽成純函式 `src/lib/knowvio-aggregations.ts`（M2 活動分桶正規化、M4 看板狀態映射、M3 趨勢 delta），以 vitest TDD 覆蓋 100%；再把 `knowvio-dashboard-page.tsx` 內各元件改吃 store 值＋純函式輸出，視覺驗收於 vite dev `/knowvio`。

**Tech Stack:** React 19 + TypeScript（strict）、Vite、vitest 3.2、`@/` alias、Tailwind CSS 4。測試與原始碼同目錄並列（`*.test.ts`）。

## Global Constraints

> 以下逐條自 spec（`docs/superpowers/specs/2026-06-27-knowvio-dashboard-live-data-design.md`）與專案規範原文照抄，每個 task 隱含包含本節。

- 範圍：純前端（fe），**不動後端、不新增 API 端點、不改 `index.css`、不動 `kv` 區域調色盤、不碰 Layer B**。
- 只在分支 `claude/busy-sagan-gm197s` 開發；未經同意不開 PR、不 push。
- 誠實優先：沒有真實前值的 delta 不假造，隱藏徽章勝過顯示假百分比。
- 純衍生、不新增 state：所有彙總用 `useMemo` 從既有 store 值算出；不新增 store 欄位。
- 空資料優雅降級：`activity` 空→甜甜圈空態；`trend7d` 空→趨勢圖空態。
- House style：`kv` 區域淺色奶油＋橘、16px 圓角、極輕陰影 `0 1px 2px rgba(0,0,0,.06)`、JetBrains Mono 數字、zh/en 成對（繁中預設）；CJK 永不 serif。
- Commit：Conventional Commits ＋ 範圍標籤（`fe`）；中文提交訊息。
- TypeScript strict、純函式部分要求 100% 覆蓋、專案整體 >80%。
- 明確不做：`QuickReview` 維持靜態 placeholder；`KvSidebar` 維持視覺不接路由；kanban 後端持久化（#2）另開 spec。

---

### Task 1: 純彙總函式 `knowvio-aggregations.ts`（M2/M3/M4 邏輯核心）

**Files:**

- Create: `tender-ai-frontend/src/lib/knowvio-aggregations.ts`
- Test: `tender-ai-frontend/src/lib/knowvio-aggregations.test.ts`

**Interfaces:**

- Consumes（自 `@/types/domain`）：`ActivityItem`、`ActivityKind`、`KanbanCard`、`TaskStatus`。
- Produces（Task 2–5 取用）：
  - `type DonutBucketKey = "view" | "rate" | "board" | "other"`
  - `interface DonutSegment { key: DonutBucketKey; count: number; pct: number }`
  - `donutSegmentsFromActivity(activity: ActivityItem[]): DonutSegment[]` — 固定回傳 4 段（順序 view/rate/board/other）；`pct` 為整數且總和=100（total>0 時），total=0 時全 0。
  - `type KnowvioStatusKind = "pending" | "notStarted" | "inProgress"`
  - `statusByTenderId(cards: KanbanCard[]): Map<string, KnowvioStatusKind>` — 多卡同 tenderId 取「最進階」狀態（rank `done>review>doing>todo`）；無 `tenderId` 的卡略過。
  - `tenderStatusKind(map: Map<string, KnowvioStatusKind>, tenderId: string): KnowvioStatusKind` — 查無→`"notStarted"`。
  - `trendDeltaPct(trend: number[]): string | null` — 末兩點百分比字串（如 `"+75%"`）；長度<2 或前值=0 回 `null`。

- [ ] **Step 1: 寫失敗測試**

```ts
// tender-ai-frontend/src/lib/knowvio-aggregations.test.ts
import { describe, it, expect } from "vitest";
import {
  donutSegmentsFromActivity,
  statusByTenderId,
  tenderStatusKind,
  trendDeltaPct,
} from "@/lib/knowvio-aggregations";
import type { ActivityItem, KanbanCard } from "@/types/domain";

function act(kind: ActivityItem["kind"]): ActivityItem {
  return {
    id: `a-${kind}-${Math.random()}`,
    at: "2026-06-27T00:00:00Z",
    userId: "u1",
    kind,
  };
}
function card(
  tenderId: string | undefined,
  status: KanbanCard["status"],
): KanbanCard {
  return { id: `c-${tenderId}-${status}`, tenderId, title: "t", status };
}

describe("donutSegmentsFromActivity", () => {
  it("空 activity → 4 桶皆 0、不爆", () => {
    const segs = donutSegmentsFromActivity([]);
    expect(segs.map((s) => s.key)).toEqual(["view", "rate", "board", "other"]);
    expect(segs.every((s) => s.count === 0 && s.pct === 0)).toBe(true);
  });

  it("依 kind 分桶且 pct 總和 = 100", () => {
    const segs = donutSegmentsFromActivity([
      act("comment"), // view
      act("accept"), // rate
      act("judge"), // rate
      act("move"), // board
      act("skip"), // other
      act("rule"), // other
      act("import"), // other
    ]);
    const by = Object.fromEntries(segs.map((s) => [s.key, s]));
    expect(by.view.count).toBe(1);
    expect(by.rate.count).toBe(2);
    expect(by.board.count).toBe(1);
    expect(by.other.count).toBe(3);
    expect(segs.reduce((n, s) => n + s.pct, 0)).toBe(100);
  });

  it("最大餘數法：3 等分仍湊到 100", () => {
    const segs = donutSegmentsFromActivity([
      act("comment"),
      act("accept"),
      act("move"),
    ]);
    expect(segs.reduce((n, s) => n + s.pct, 0)).toBe(100);
  });
});

describe("statusByTenderId / tenderStatusKind", () => {
  it("TaskStatus → KnowvioStatusKind 映射", () => {
    const map = statusByTenderId([
      card("t1", "todo"),
      card("t2", "doing"),
      card("t3", "review"),
      card("t4", "done"),
    ]);
    expect(map.get("t1")).toBe("notStarted");
    expect(map.get("t2")).toBe("inProgress");
    expect(map.get("t3")).toBe("inProgress");
    expect(map.get("t4")).toBe("pending");
  });

  it("多卡同 tenderId → 取最進階狀態", () => {
    const map = statusByTenderId([
      card("t1", "todo"),
      card("t1", "review"),
      card("t1", "doing"),
    ]);
    expect(map.get("t1")).toBe("inProgress"); // review 最進階 → inProgress
  });

  it("無 tenderId 的卡略過；查無 → notStarted", () => {
    const map = statusByTenderId([card(undefined, "done")]);
    expect(map.size).toBe(0);
    expect(tenderStatusKind(map, "nope")).toBe("notStarted");
  });
});

describe("trendDeltaPct", () => {
  it("末兩點百分比（含正號）", () => {
    expect(trendDeltaPct([3, 5, 2, 6, 4, 8, 14])).toBe("+75%");
  });
  it("負成長無正號", () => {
    expect(trendDeltaPct([10, 5])).toBe("-50%");
  });
  it("長度<2 或前值=0 → null（誠實隱藏）", () => {
    expect(trendDeltaPct([5])).toBeNull();
    expect(trendDeltaPct([0, 5])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd tender-ai-frontend && npx vitest run src/lib/knowvio-aggregations.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/knowvio-aggregations"`）

- [ ] **Step 3: 寫最小實作**

```ts
// tender-ai-frontend/src/lib/knowvio-aggregations.ts
import type {
  ActivityItem,
  ActivityKind,
  KanbanCard,
  TaskStatus,
} from "@/types/domain";

export type DonutBucketKey = "view" | "rate" | "board" | "other";

export interface DonutSegment {
  key: DonutBucketKey;
  count: number;
  pct: number;
}

const KIND_TO_BUCKET: Record<ActivityKind, DonutBucketKey> = {
  comment: "view",
  accept: "rate",
  judge: "rate",
  move: "board",
  skip: "other",
  rule: "other",
  import: "other",
};

const BUCKET_ORDER: DonutBucketKey[] = ["view", "rate", "board", "other"];

export function donutSegmentsFromActivity(
  activity: ActivityItem[],
): DonutSegment[] {
  const counts: Record<DonutBucketKey, number> = {
    view: 0,
    rate: 0,
    board: 0,
    other: 0,
  };
  for (const a of activity) counts[KIND_TO_BUCKET[a.kind]] += 1;

  const total = activity.length;
  if (total === 0)
    return BUCKET_ORDER.map((key) => ({ key, count: 0, pct: 0 }));

  // 最大餘數法（largest remainder）：先取整數樓地板，餘額補給小數最大者，確保總和=100。
  const rows = BUCKET_ORDER.map((key) => {
    const exact = (counts[key] / total) * 100;
    const floor = Math.floor(exact);
    return { key, count: counts[key], floor, rem: exact - floor };
  });
  const used = rows.reduce((s, r) => s + r.floor, 0);
  const remaining = 100 - used;
  const bump = new Set<DonutBucketKey>(
    [...rows]
      .sort((a, b) => b.rem - a.rem)
      .slice(0, remaining)
      .map((r) => r.key),
  );
  return rows.map((r) => ({
    key: r.key,
    count: r.count,
    pct: r.floor + (bump.has(r.key) ? 1 : 0),
  }));
}

export type KnowvioStatusKind = "pending" | "notStarted" | "inProgress";

const TASK_TO_KNOWVIO: Record<TaskStatus, KnowvioStatusKind> = {
  todo: "notStarted",
  doing: "inProgress",
  review: "inProgress",
  done: "pending",
};

const STATUS_RANK: Record<TaskStatus, number> = {
  todo: 0,
  doing: 1,
  review: 2,
  done: 3,
};

export function statusByTenderId(
  cards: KanbanCard[],
): Map<string, KnowvioStatusKind> {
  const best = new Map<string, TaskStatus>();
  for (const c of cards) {
    if (!c.tenderId) continue;
    const cur = best.get(c.tenderId);
    if (cur === undefined || STATUS_RANK[c.status] > STATUS_RANK[cur])
      best.set(c.tenderId, c.status);
  }
  const out = new Map<string, KnowvioStatusKind>();
  for (const [id, st] of best) out.set(id, TASK_TO_KNOWVIO[st]);
  return out;
}

export function tenderStatusKind(
  map: Map<string, KnowvioStatusKind>,
  tenderId: string,
): KnowvioStatusKind {
  return map.get(tenderId) ?? "notStarted";
}

export function trendDeltaPct(trend: number[]): string | null {
  if (trend.length < 2) return null;
  const prev = trend[trend.length - 2];
  const last = trend[trend.length - 1];
  if (prev === 0) return null;
  const pct = Math.round(((last - prev) / prev) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd tender-ai-frontend && npx vitest run src/lib/knowvio-aggregations.test.ts`
Expected: PASS（全部 9 個 it）

- [ ] **Step 5: Commit**

```bash
git add tender-ai-frontend/src/lib/knowvio-aggregations.ts tender-ai-frontend/src/lib/knowvio-aggregations.test.ts
git commit -m "feat(fe): 抽出 knowvio 彙總純函式（活動分桶/看板狀態/趨勢 delta）＋TDD"
```

---

### Task 2: M1 趨勢圖綁 `trend7d`＋tooltip delta 真值

**Files:**

- Modify: `tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx`（`SERIES` 常數 L548、`ProgressArea` L553-701、呼叫處 L~160）

**Interfaces:**

- Consumes：`useAppData().trend7d: number[]`（已暴露）、`trendDeltaPct`（Task 1）。
- Produces：`<ProgressArea lang series={number[]} />`；無下游消費。

- [ ] **Step 1: 改 `ProgressArea` 簽名吃 `series` prop，移除寫死 `SERIES`**

把 `const SERIES = [8, 12, ... 75];`（L548）整段刪除。`ProgressArea` 改為：

```tsx
function ProgressArea({ lang, series }: { lang: Lang; series: number[] }) {
  const tx = TX[lang];
  // 空資料優雅降級
  if (series.length === 0) {
    return (
      <div className="kv-progress-empty">
        {/* 沿用既有空態樣式類別；無資料時顯示提示 */}
        <span>{lang === "zh" ? "尚無趨勢資料" : "No trend data yet"}</span>
      </div>
    );
  }
  const max = Math.max(...series, 1);
  // X 軸：近 N 日（N = series.length），改用真實點數而非寫死 30
  // 其餘 path / area 幾何沿用既有計算，但以 series 與 series.length 取代 SERIES 與 30。
  // tooltip 徽章改吃真值：
  const delta = trendDeltaPct(series);
  // ...（既有 SVG path、area、座標軸 render，將所有 SERIES→series、30→series.length、L673 寫死 "+5%"→{delta ?? ""}，delta 為 null 時不渲染徽章）
  return (/* 既有 JSX，套上上述替換 */);
}
```

> 實作注意：原 `dateLabel(i)`／X 軸 ticks `[1,5,10,15,20,25,30]` 改為依 `series.length` 產生（7 點時顯示 `近 7 日`）。`progressSub` 文案 `近 30 日`→改 `近 7 日`／`last 7 days`（見 Step 3）。`delta` 為 `null` 時，tooltip 不渲染百分比徽章元素。

- [ ] **Step 2: 加 import 並更新呼叫處**

頁面頂部 import 區加：

```tsx
import {
  donutSegmentsFromActivity,
  statusByTenderId,
  tenderStatusKind,
  trendDeltaPct,
} from "@/lib/knowvio-aggregations";
```

呼叫處（原 `<ProgressArea lang={lang} />`）改為：

```tsx
<ProgressArea lang={lang} series={trend7d} />
```

並在元件頂部解構加入 `trend7d`：

```tsx
const { metrics, filteredTenders, usingLiveData, activity, cards, trend7d } =
  useAppData();
```

- [ ] **Step 3: i18n 文案改成對（近 7 日）**

在 `TX` 字典 zh/en 把趨勢副標由「近 30 日 / last 30 days」改為：

```ts
// zh
progressSub: "近 7 日新案趨勢",
// en
progressSub: "Last 7 days · new tenders",
```

（若原 key 名不同，沿用原 key，只改值；確保 zh/en 成對。）

- [ ] **Step 4: typecheck＋現有測試**

Run: `cd tender-ai-frontend && npx tsc --noEmit && npx vitest run`
Expected: 0 type error；既有測試全綠。

- [ ] **Step 5: Commit**

```bash
git add tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx
git commit -m "feat(fe): knowvio 趨勢圖綁 trend7d 真資料＋tooltip delta 真值（M1）"
```

---

### Task 3: M2 活動甜甜圈綁 `activity`

**Files:**

- Modify: `tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx`（`ActivityDonut` L703-772、呼叫處）

**Interfaces:**

- Consumes：`useAppData().activity`、`donutSegmentsFromActivity`（Task 1）。
- Produces：無下游消費。

- [ ] **Step 1: `ActivityDonut` 改吃 `activity`，移除寫死 segs 與中央「42」**

```tsx
function ActivityDonut({ tx, activity }: { tx: (typeof TX)[Lang]; activity: ActivityItem[] }) {
  const COLOR: Record<DonutBucketKey, string> = {
    view: "#fb923c",
    rate: "#3b82f6",
    board: "#ec4899",
    other: "#22c55e",
  };
  const LABEL: Record<DonutBucketKey, string> = {
    view: tx.actView,
    rate: tx.actRate,
    board: tx.actBoard,
    other: tx.actExport,
  };
  const segs = donutSegmentsFromActivity(activity);
  const total = activity.length;
  // 以 segs[].pct 畫各弧段（取代寫死 45/25/20/10）；中央數字＝total（取代寫死 42）。
  // total === 0 → 顯示空態（灰環＋中央 0 或提示文案）。
  return (/* 既有環形 SVG，segs 驅動弧長、COLOR 上色、LABEL 出圖例、中央顯示 {total} */);
}
```

> 需 `import type { ActivityItem } from "@/types/domain";` 與 `import type { DonutBucketKey } from "@/lib/knowvio-aggregations";`（後者與 Task 2 的值 import 合併：`import { donutSegmentsFromActivity, ... , type DonutBucketKey } from "@/lib/knowvio-aggregations";`）。

- [ ] **Step 2: 更新呼叫處**

原 `<ActivityDonut tx={tx} />` → `<ActivityDonut tx={tx} activity={activity} />`。

- [ ] **Step 3: typecheck＋測試**

Run: `cd tender-ai-frontend && npx tsc --noEmit && npx vitest run`
Expected: 0 type error；測試全綠。

- [ ] **Step 4: Commit**

```bash
git add tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx
git commit -m "feat(fe): knowvio 活動甜甜圈由 activity 真實彙總＋中央計數（M2）"
```

---

### Task 4: M3 KPI delta 徽章（誠實隱藏無真值者）

**Files:**

- Modify: `tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx`（`KpiCard` L420-461、KPI 卡片群 L173-202）

**Interfaces:**

- Consumes：`trendDeltaPct(trend7d)`（Task 1）。
- Produces：`KpiCard` 的 `delta` 變為選用 `delta?: string | null`。

- [ ] **Step 1: `KpiCard` 的 `delta` 改選用、null 不渲染徽章**

```tsx
function KpiCard({
  icon,
  label,
  value,
  suffix,
  delta,
  chart,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  suffix?: string;
  delta?: string | null;
  chart: ReactNode;
}) {
  return (
    <div className="kv-kpi">
      {/* ...既有 icon/label/value/suffix... */}
      {delta ? <span className="kv-kpi-delta">{delta}</span> : null}
      {chart}
    </div>
  );
}
```

- [ ] **Step 2: KPI 群套真值/隱藏**

- 「今日新案」`kpiNew` 卡：`delta={trendDeltaPct(trend7d)}`（有真實前值才顯示）。
- 其餘三張（`kpiHigh`/`avgScore`/`kpiAccepted`）：移除寫死 `"+5%"/"+10%"/"+6%"`，改傳 `delta={null}`（無真實前值，誠實不顯示）。

- [ ] **Step 3: typecheck＋測試**

Run: `cd tender-ai-frontend && npx tsc --noEmit && npx vitest run`
Expected: 0 type error；測試全綠。

- [ ] **Step 4: Commit**

```bash
git add tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx
git commit -m "feat(fe): knowvio KPI delta 改真值＋誠實隱藏無前值徽章（M3）"
```

---

### Task 5: M4 截止表狀態由 `cards` 映射

**Files:**

- Modify: `tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx`（`DeadlineTable` L774-865、呼叫處）

**Interfaces:**

- Consumes：`useAppData().cards`、`statusByTenderId`/`tenderStatusKind`/`KnowvioStatusKind`（Task 1）。
- Produces：無下游消費。

- [ ] **Step 1: 頁面層算 `statusMap`（useMemo），傳入 `DeadlineTable`**

在元件主體（`upcoming` useMemo 附近）加：

```tsx
const statusMap = useMemo(() => statusByTenderId(cards), [cards]);
```

呼叫處把 `statusMap` 傳入 `DeadlineTable`。

- [ ] **Step 2: `DeadlineTable` 移除假 `statusByIdx[i % 3]`，改查真實狀態**

```tsx
function DeadlineTable({
  rows,
  live,
  lang,
  statusMap,
}: {
  rows: Tender[];
  live: boolean;
  lang: Lang;
  statusMap: Map<string, KnowvioStatusKind>;
}) {
  // 刪除：const statusByIdx: StatusKind[] = [...]
  // 每列改：const sk = tenderStatusKind(statusMap, r.id);
  // STATUS_STYLE[sk] 沿用既有配色。
}
```

> `StatusKind`（頁面內既有 type）與 Task 1 的 `KnowvioStatusKind` 值域一致（`pending|notStarted|inProgress`）。把 `DeadlineTable` 的 `statusMap` 參數型別宣告為 `Map<string, KnowvioStatusKind>`，內部 `STATUS_STYLE` 仍以該值索引。需 `import { ... , type KnowvioStatusKind } from "@/lib/knowvio-aggregations";`（與既有 import 合併）。

- [ ] **Step 3: typecheck＋測試**

Run: `cd tender-ai-frontend && npx tsc --noEmit && npx vitest run`
Expected: 0 type error；測試全綠。

- [ ] **Step 4: Commit**

```bash
git add tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx
git commit -m "feat(fe): knowvio 截止表狀態改由看板 cards 映射，移除 i%3 假輪播（M4）"
```

---

### Task 6: M5 歡迎副標插值 `metrics.kpiHigh`

**Files:**

- Modify: `tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx`（`TX.welcomeSub` L38/L79、`TopWelcome` 元件與呼叫處）

**Interfaces:**

- Consumes：`useAppData().metrics.kpiHigh`。
- Produces：`<TopWelcome ... highCount={number} />`。

- [ ] **Step 1: `welcomeSub` 改為帶 `{n}` 佔位的模板（zh/en 成對）**

```ts
// zh
welcomeSub: "今天有 {n} 件高潛力新案，別錯過 →",
// en
welcomeSub: "{n} high-potential tenders today — don't miss them →",
```

- [ ] **Step 2: `TopWelcome` 接 `highCount` 並插值**

```tsx
function TopWelcome({
  tx,
  highCount,
}: {
  tx: (typeof TX)[Lang];
  highCount: number;
}) {
  const sub = tx.welcomeSub.replace("{n}", String(highCount));
  // ...既有 JSX，副標處用 {sub}（取代寫死「3」）
}
```

呼叫處：`<TopWelcome tx={tx} highCount={metrics.kpiHigh} />`。

- [ ] **Step 3: typecheck＋測試**

Run: `cd tender-ai-frontend && npx tsc --noEmit && npx vitest run`
Expected: 0 type error；測試全綠。

- [ ] **Step 4: Commit**

```bash
git add tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx
git commit -m "feat(fe): knowvio 歡迎副標插值 metrics.kpiHigh，移除寫死數字（M5）"
```

---

### Task 7: 視覺驗收（vite dev `/knowvio`）

**Files:** 無（驗證 only）

- [ ] **Step 1: 啟動 dev server（若未啟動）**

`preview_start`（vite dev，5173，HMR）。

- [ ] **Step 2: 載入 `/knowvio` 並檢查**

`preview_eval: window.location.assign("/knowvio")` → `preview_console_logs`（無 error）→ `preview_snapshot`：

- 趨勢圖為 **7 點**、X 軸「近 7 日」。
- 甜甜圈弧段佔比與圖例一致、中央數字＝活動筆數。
- KPI 卡：今日新案有 delta 徽章，其餘三張無假徽章。
- 截止表狀態欄非 `i%3` 輪播。
- 歡迎副標數字＝真實 `kpiHigh`。

- [ ] **Step 3: 留證**

`preview_screenshot` 存 knowvio 全頁截圖。

- [ ] **Step 4: 最終回歸**

Run: `cd tender-ai-frontend && npx tsc --noEmit && npx vitest run`
Expected: 0 type error；全測試綠。

---

## 自我檢查（writing-plans self-review）

**1. Spec coverage：** M1→Task2、M2→Task3、M3→Task4、M4→Task5、M5→Task6、純函式測試→Task1、視覺驗收→Task7。明確不做（QuickReview/KvSidebar/#2/不改 index.css）列於 Global Constraints。✅ 全覆蓋。

**2. Placeholder scan：** 純函式（Task1）給出完整可執行程式碼與測試。Task2–6 因頁面元件達 900 行、需就地替換既有 SVG 幾何，採「精確定位＋替換規則＋關鍵片段」而非整檔重貼——每處標明確切 symbol、行號區間、替換對應（SERIES→series、30→series.length、寫死值→真值/null）。無 TBD/TODO。

**3. Type consistency：** `DonutBucketKey`/`DonutSegment`/`KnowvioStatusKind`/`statusByTenderId`/`tenderStatusKind`/`trendDeltaPct`/`donutSegmentsFromActivity` 命名於 Task1 定義、Task2–6 一致引用。`StatusKind`（頁面內）與 `KnowvioStatusKind` 值域相同（pending|notStarted|inProgress）。`KpiCard.delta` 由必填 string 改 `string | null` 選用，呼叫處對應更新。✅
