# Tender Detail View Rich Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把窄版標案詳情 `Dialog` 升級為資訊豐富的寬版雙欄詳情：完整欄位、可解釋的可行性分數、關鍵匹配、行動鈕（承接／略過／儲存／轉發／評價／註記／意義標籤），並擴充排序與篩選（北部城市 / 當日新案 / URL 分享）。

**Architecture:** 純前端。新增三個純函式模組（`keyword-hits.ts` 共用比對器、`feasibility.ts` 可解釋啟發式分數、`url-filter.ts` 篩選序列化）由 vitest 單元測覆蓋；`detail-bits.tsx` 擴充共用展示元件；`tender-drawer.tsx` 改寫為寬版雙欄；行動鈕接 `api.ts` 既有 fire-and-forget 模式（新增 `postRate`/`postShare`）。可行性與關鍵命中在 store 以 memo 衍生（不持久化），供詳情顯示與排序共用同一來源。

**Tech Stack:** React 19 + Vite 8 + TypeScript 6 + Tailwind 4（自寫 UI primitive，無 Radix）+ react-router-dom 7 + lucide-react；測試新增 vitest（node 環境，pure function only）。

## Global Constraints

- 純前端，**後端零變更**：不碰 scraper／`tables[4]`／SkipSSLAdapter，不改任何 `app/schemas/*` 或 API 路由。
- 後端尚未吐出的欄位（履約地點／資格摘要／附件／可見註記／評價理由入 RAG／tag 權重後台）一律以「待補」`PlaceholderBlock` 呈現，不留空白、不報錯。
- 不引入 Radix；沿用既有 `Dialog`/`Badge`/`Button`/`Input`/`TierBadge`/`FeasibilityMeter` primitive。
- i18n `src/i18n/strings.ts` 為 `as const`，zh 與 en **必須成對加 key**，否則 `TextKey` 型別編譯失敗。
- 後端寫入皆 fire-and-forget；`localStorage` 仍是前端真相來源，寫入失敗靜默、不回滾。
- 此工作區**非 git repo**（cwd / frontend / backend 皆 not a git repository）→ 原地編輯、**無法 commit/worktree**。各任務以 `npm run build` + `npx vitest run` 取代 commit 作為驗收閘門。
- `VITE_API_KEY` 等金鑰僅由環境注入，永不寫入版控；HQadmin/HQadmin 僅為佔位帳密，非正式 secret。
- 預算甜蜜區上界 = `50_000_000`（5000 萬 TWD）。內建室內裝修詞庫 = `整修 / 教室 / 空間改善 / 防水 / 室內 / 裝修 / 修繕 / 拆除`。北部城市 = `台北 / 新北 / 基隆 / 桃園`。

---

## File Structure

新增：

- `src/lib/keyword-hits.ts` — 共用關鍵字比對器（focus 規則 ∪ 內建詞庫 vs `title+org`）。
- `src/lib/feasibility.ts` — 可解釋可行性分數純函式（依賴 keyword-hits）。
- `src/lib/url-filter.ts` — 篩選狀態 ↔ URL query 序列化／還原。
- `src/lib/*.test.ts` — 上述三者單元測。
- `vitest.config.ts` — 測試設定（node 環境、`@` alias、`src/**/*.test.ts`）。

修改：

- `src/types/domain.ts` — `FilterState` 加 `northOnly` / `newToday`。
- `src/store/app-data.tsx` — `DEFAULT_FILTER` 補欄位、`filteredTenders` 加 northOnly/newToday 子句與可行性排序、衍生 `feasOf`/`keywordHitsOf` memo、URL 同步接線。
- `src/components/tenders/detail-bits.tsx` — 新增 `LabelTags`/`FeasibilityBadge`/`DaysLeftBanner`/`PlaceholderBlock`/`RatingStars`。
- `src/components/tenders/tender-drawer.tsx` — 寬版雙欄改寫，整合上列元件與行動鈕。
- `src/lib/api.ts` — 新增 `postRate`/`postShare`。
- `src/components/tenders/filter-bar.tsx` — 北部城市 / 當日新案 chip。
- `src/i18n/strings.ts` — 成對新增 key。
- `package.json` — 加 `test` script 與 vitest devDependency。

---

## Task 0: Test harness（vitest）

**Files:**

- Modify: `package.json`（scripts + devDependencies）
- Create: `vitest.config.ts`
- Create: `src/lib/smoke.test.ts`（驗證 harness，通過後刪除或保留皆可）

**Interfaces:**

- Consumes: 無。
- Produces: `npx vitest run` 可執行；`@` alias 在測試中可解析。

- [ ] **Step 1: 安裝 vitest**

Run:

```bash
cd "/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-ai-frontend" && npm install -D vitest@^3
```

Expected: 安裝成功，`package.json` devDependencies 出現 `vitest`。

- [ ] **Step 2: 建立 vitest.config.ts**

Create `vitest.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: 加 test script**

Modify `package.json` scripts（在 `"preview": "vite preview"` 後加一行）：

```json
    "preview": "vite preview",
    "test": "vitest run"
```

- [ ] **Step 4: 寫 smoke test**

Create `src/lib/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 執行確認通過**

Run:

```bash
npx vitest run src/lib/smoke.test.ts
```

Expected: PASS（1 passed）。

---

## Task 1: keyword-hits.ts（共用關鍵字比對器）

**Files:**

- Create: `src/lib/keyword-hits.ts`
- Test: `src/lib/keyword-hits.test.ts`

**Interfaces:**

- Consumes: `Tender`（`@/types/domain`，使用 `title`/`org`）。
- Produces:
  - `export const BUILTIN_KEYWORDS: readonly string[]`
  - `export function keywordHits(tender: Pick<Tender, "title" | "org">, focusRules: string[]): string[]` — 回傳命中詞（focusRules ∪ BUILTIN 去重後，逐詞 `includes` 比對 `title+org`），保留比對來源順序、不重複、忽略空字串。

- [ ] **Step 1: 寫失敗測試**

Create `src/lib/keyword-hits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { keywordHits, BUILTIN_KEYWORDS } from "@/lib/keyword-hits";

const T = (title: string, org = "") => ({ title, org });

describe("keywordHits", () => {
  it("命中內建詞庫", () => {
    expect(keywordHits(T("某國小教室整修工程"), [])).toEqual(
      expect.arrayContaining(["整修", "教室"]),
    );
  });

  it("命中 focus 規則並與內建合併去重", () => {
    const hits = keywordHits(T("醫院室內裝修"), ["醫院", "室內"]);
    expect(hits).toContain("醫院");
    expect(hits).toContain("室內");
    expect(hits).toContain("裝修");
    expect(new Set(hits).size).toBe(hits.length); // 無重複
  });

  it("比對 org 欄位", () => {
    expect(keywordHits(T("採購案", "臺北市政府教室管理處"), [])).toContain(
      "教室",
    );
  });

  it("未命中回空陣列", () => {
    expect(keywordHits(T("純道路鋪設"), ["醫院"])).toEqual([]);
  });

  it("忽略空字串規則", () => {
    expect(keywordHits(T("室內裝修"), ["", "  "])).not.toContain("");
  });

  it("匯出內建詞庫含關鍵詞", () => {
    expect(BUILTIN_KEYWORDS).toContain("裝修");
    expect(BUILTIN_KEYWORDS).toContain("防水");
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run src/lib/keyword-hits.test.ts`
Expected: FAIL（Cannot find module '@/lib/keyword-hits'）。

- [ ] **Step 3: 實作**

Create `src/lib/keyword-hits.ts`:

```ts
// 共用關鍵字比對器：詳情命中標籤與可行性分數共用同一來源，避免兩處邏輯分歧。
import type { Tender } from "@/types/domain";

// 內建室內裝修詞庫（業務基準命中詞）。
export const BUILTIN_KEYWORDS: readonly string[] = [
  "整修",
  "教室",
  "空間改善",
  "防水",
  "室內",
  "裝修",
  "修繕",
  "拆除",
];

/**
 * 回傳標案命中的關鍵詞（focus 規則 ∪ 內建詞庫，逐詞 includes 比對 title+org）。
 * 保留比對來源順序、去重、忽略空字串。
 */
export function keywordHits(
  tender: Pick<Tender, "title" | "org">,
  focusRules: string[],
): string[] {
  const haystack = `${tender.title} ${tender.org}`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...focusRules, ...BUILTIN_KEYWORDS]) {
    const w = raw.trim();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    if (haystack.includes(w)) out.push(w);
  }
  return out;
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run src/lib/keyword-hits.test.ts`
Expected: PASS。

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 編譯通過（無型別錯誤）。

---

## Task 2: feasibility.ts（可解釋可行性分數）

**Files:**

- Create: `src/lib/feasibility.ts`
- Test: `src/lib/feasibility.test.ts`

**Interfaces:**

- Consumes: `keywordHits`（Task 1）、`Tender`（使用 `title`/`org`/`category`/`budget`）。
- Produces:
  - `export interface FeasBreakdown { label: string; delta: number }`
  - `export interface FeasResult { score: number; breakdown: FeasBreakdown[] }`
  - `export interface FeasRules { focus: string[]; hard: string[] }`
  - `export interface FeasLabels { works: string; goods: string; services: string; budgetFit: string; deadlineFar: string; deadlineMid: string; deadlineNear: string; hardExcluded: string }`
  - `export function computeFeasibility(tender: Pick<Tender, "title"|"org"|"category"|"budget">, rules: FeasRules, daysLeftValue: number, labels: FeasLabels): FeasResult`
    - 純函式（不讀時間）：呼叫端傳入 `daysLeftValue`（由 `daysLeft(tender.deadline)` 算）。
    - 規則：每命中關鍵詞 +8（label = 該詞）；類別 works+20/goods+8/services+4；預算落在 `(0, 50_000_000]` +15；截止 `>14` +10 / `7..14` +4 / `<7`（含已過）−8；命中 hard 規則 → 分數 cap ≤30 並加一筆負項；最後 clamp 0..100。

- [ ] **Step 1: 寫失敗測試**

Create `src/lib/feasibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeFeasibility,
  type FeasLabels,
  type FeasRules,
} from "@/lib/feasibility";

const LABELS: FeasLabels = {
  works: "工程",
  goods: "財物",
  services: "勞務",
  budgetFit: "預算適配",
  deadlineFar: "截止充裕",
  deadlineMid: "截止適中",
  deadlineNear: "截止近",
  hardExcluded: "硬排除",
};
const RULES: FeasRules = { focus: [], hard: ["綜合營造業"] };

const base = {
  title: "某國小教室整修工程",
  org: "臺北市政府",
  category: "works" as const,
  budget: 8_000_000,
};

describe("computeFeasibility", () => {
  it("加總命中／類別／預算／截止", () => {
    // 命中 整修+教室+工程(內建?) → 至少 整修、教室 各+8；works +20；預算 +15；截止 30 天 +10
    const r = computeFeasibility(base, RULES, 30, LABELS);
    expect(r.score).toBeGreaterThan(40);
    expect(r.breakdown.some((b) => b.label === "整修" && b.delta === 8)).toBe(
      true,
    );
    expect(
      r.breakdown.some((b) => b.label === LABELS.works && b.delta === 20),
    ).toBe(true);
    expect(
      r.breakdown.some((b) => b.label === LABELS.budgetFit && b.delta === 15),
    ).toBe(true);
  });

  it("截止 <7 天扣分", () => {
    const r = computeFeasibility(base, RULES, 3, LABELS);
    expect(
      r.breakdown.some(
        (b) => b.label === LABELS.deadlineNear && b.delta === -8,
      ),
    ).toBe(true);
  });

  it("命中硬排除 → 分數壓到 30 以下", () => {
    const r = computeFeasibility(
      { ...base, title: "綜合營造業統包工程整修教室" },
      RULES,
      30,
      LABELS,
    );
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.breakdown.some((b) => b.label === LABELS.hardExcluded)).toBe(true);
  });

  it("clamp 不超過 100、不低於 0", () => {
    const high = computeFeasibility(
      { ...base, title: "整修教室室內裝修修繕防水拆除空間改善" },
      { focus: [], hard: [] },
      30,
      LABELS,
    );
    expect(high.score).toBeLessThanOrEqual(100);
    expect(high.score).toBeGreaterThanOrEqual(0);
  });

  it("類別 services 僅 +4", () => {
    const r = computeFeasibility(
      { ...base, category: "services" },
      { focus: [], hard: [] },
      30,
      LABELS,
    );
    expect(
      r.breakdown.some((b) => b.label === LABELS.services && b.delta === 4),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx vitest run src/lib/feasibility.test.ts`
Expected: FAIL（Cannot find module '@/lib/feasibility'）。

- [ ] **Step 3: 實作**

Create `src/lib/feasibility.ts`:

```ts
// 可解釋可行性分數（前端啟發式）。純函式：不讀時間，daysLeft 由呼叫端傳入。
// RAG 上線後可把「室內裝修匹配度／歷史相似案」併入 breakdown，介面不變。
import type { Category, Tender } from "@/types/domain";
import { keywordHits } from "@/lib/keyword-hits";

export interface FeasBreakdown {
  label: string;
  delta: number;
}
export interface FeasResult {
  score: number;
  breakdown: FeasBreakdown[];
}
export interface FeasRules {
  focus: string[];
  hard: string[];
}
export interface FeasLabels {
  works: string;
  goods: string;
  services: string;
  budgetFit: string;
  deadlineFar: string;
  deadlineMid: string;
  deadlineNear: string;
  hardExcluded: string;
}

const KEYWORD_DELTA = 8;
const CATEGORY_DELTA: Record<Category, number> = {
  works: 20,
  goods: 8,
  services: 4,
};
const BUDGET_SWEET_MAX = 50_000_000; // 5000 萬 TWD
const BUDGET_DELTA = 15;
const HARD_CAP = 30;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeFeasibility(
  tender: Pick<Tender, "title" | "org" | "category" | "budget">,
  rules: FeasRules,
  daysLeftValue: number,
  labels: FeasLabels,
): FeasResult {
  const breakdown: FeasBreakdown[] = [];

  // 關鍵字命中
  for (const w of keywordHits(tender, rules.focus)) {
    breakdown.push({ label: w, delta: KEYWORD_DELTA });
  }

  // 類別匹配
  const catLabel =
    tender.category === "works"
      ? labels.works
      : tender.category === "goods"
        ? labels.goods
        : labels.services;
  breakdown.push({ label: catLabel, delta: CATEGORY_DELTA[tender.category] });

  // 預算適配（甜蜜區）
  if (tender.budget > 0 && tender.budget <= BUDGET_SWEET_MAX) {
    breakdown.push({ label: labels.budgetFit, delta: BUDGET_DELTA });
  }

  // 截止適配
  if (daysLeftValue > 14) {
    breakdown.push({ label: labels.deadlineFar, delta: 10 });
  } else if (daysLeftValue >= 7) {
    breakdown.push({ label: labels.deadlineMid, delta: 4 });
  } else {
    breakdown.push({ label: labels.deadlineNear, delta: -8 });
  }

  // 硬排除命中 → 分數壓到 ≤30
  const hardHit = rules.hard.some(
    (h) => h.trim() && `${tender.title} ${tender.org}`.includes(h.trim()),
  );

  let score = breakdown.reduce((s, b) => s + b.delta, 0);
  if (hardHit) {
    score = Math.min(score, HARD_CAP);
    breakdown.push({ label: labels.hardExcluded, delta: 0 });
  }

  return { score: clamp(Math.round(score), 0, 100), breakdown };
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npx vitest run src/lib/feasibility.test.ts`
Expected: PASS。

- [ ] **Step 5: 型別檢查**

Run: `npm run build`
Expected: 編譯通過。

---

## Task 3: domain.ts + url-filter.ts（篩選擴充欄位 + URL 同步）

**Files:**

- Modify: `src/types/domain.ts:135-160`（`FilterState` 加 `northOnly`/`newToday`）
- Create: `src/lib/url-filter.ts`
- Test: `src/lib/url-filter.test.ts`

**Interfaces:**

- Consumes: `FilterState`、`SortKey`、`SourceKey`、`Tier`、`Category`（`@/types/domain`）。
- Produces:
  - `export const NORTH_CITIES: readonly string[]`（`["台北","新北","基隆","桃園"]`）
  - `export function serializeFilter(filter: FilterState): string` — 只序列化「非預設」欄位的 URLSearchParams 字串（不含 `?`）。
  - `export function parseFilter(search: string, base: FilterState): FilterState` — 容錯解析，合併到 `base`；解析失敗回 `base`。
  - 往返不變式：`parseFilter("?" + serializeFilter(f), DEFAULT)` 深等於 `f`（針對所有欄位）。

- [ ] **Step 1: 擴充 FilterState 型別**

Modify `src/types/domain.ts`，在 `FilterState` 介面 `tagFilter: string[];` 之後、`sort: SortKey;` 之前（依實際欄位順序）新增兩個欄位。具體：找到 `deadlineTo` 與 `tagFilter` 宣告區塊，加入：

```ts
/** 只看北部城市（台北/新北/基隆/桃園） */
northOnly: boolean;
/** 只看當日新案（lastSeen/publishedAt 為今天） */
newToday: boolean;
```

（放在 `tagFilter: string[];` 之後即可。）

- [ ] **Step 2: 寫失敗測試**

Create `src/lib/url-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeFilter, parseFilter, NORTH_CITIES } from "@/lib/url-filter";
import type { FilterState } from "@/types/domain";

const DEFAULT: FilterState = {
  query: "",
  sources: [],
  tiers: [],
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

describe("url-filter", () => {
  it("預設值序列化為空字串", () => {
    expect(serializeFilter(DEFAULT)).toBe("");
  });

  it("往返保真（含各型別欄位）", () => {
    const f: FilterState = {
      ...DEFAULT,
      query: "教室 整修",
      sources: ["PCC", "TMU"],
      tiers: ["high"],
      maxBudget: 8_000_000,
      focusOnly: true,
      hideExcluded: false,
      sort: "feasibility",
      categories: ["works", "goods"],
      orgKeyword: "臺北",
      deadlineFrom: "2026-06-01",
      deadlineTo: "2026-07-01",
      tagFilter: ["室內", "防水"],
      northOnly: true,
      newToday: true,
    };
    const round = parseFilter("?" + serializeFilter(f), DEFAULT);
    expect(round).toEqual(f);
  });

  it("解析空字串回 base", () => {
    expect(parseFilter("", DEFAULT)).toEqual(DEFAULT);
  });

  it("忽略未知 key、容錯壞值", () => {
    const r = parseFilter("?bogus=x&maxBudget=notnum&sort=weird", DEFAULT);
    expect(r.maxBudget).toBeNull();
    expect(r.sort).toBe("score");
  });

  it("匯出北部城市清單", () => {
    expect(NORTH_CITIES).toContain("台北");
    expect(NORTH_CITIES).toContain("桃園");
  });
});
```

- [ ] **Step 3: 執行確認失敗**

Run: `npx vitest run src/lib/url-filter.test.ts`
Expected: FAIL（Cannot find module '@/lib/url-filter'）。

- [ ] **Step 4: 實作**

Create `src/lib/url-filter.ts`:

```ts
// 篩選狀態 ↔ URL query 序列化／還原。只放非預設欄位，容錯解析。
import type {
  Category,
  FilterState,
  SortKey,
  SourceKey,
  Tier,
} from "@/types/domain";

export const NORTH_CITIES: readonly string[] = ["台北", "新北", "基隆", "桃園"];

const SORT_KEYS: SortKey[] = ["score", "deadline", "budget", "feasibility"];
const SOURCE_KEYS: SourceKey[] = ["PCC", "TMU", "TPC", "NPC"];
const TIER_KEYS: Tier[] = ["high", "mid", "low"];
const CATEGORY_KEYS: Category[] = ["works", "goods", "services"];

export function serializeFilter(filter: FilterState): string {
  const p = new URLSearchParams();
  if (filter.query) p.set("q", filter.query);
  if (filter.sources.length) p.set("src", filter.sources.join(","));
  if (filter.tiers.length) p.set("tier", filter.tiers.join(","));
  if (filter.maxBudget != null) p.set("budget", String(filter.maxBudget));
  if (filter.focusOnly) p.set("focus", "1");
  if (!filter.hideExcluded) p.set("showExcluded", "1");
  if (filter.sort !== "score") p.set("sort", filter.sort);
  if (filter.categories.length) p.set("cat", filter.categories.join(","));
  if (filter.orgKeyword) p.set("org", filter.orgKeyword);
  if (filter.deadlineFrom) p.set("from", filter.deadlineFrom);
  if (filter.deadlineTo) p.set("to", filter.deadlineTo);
  if (filter.tagFilter.length) p.set("tags", filter.tagFilter.join(","));
  if (filter.northOnly) p.set("north", "1");
  if (filter.newToday) p.set("new", "1");
  return p.toString();
}

function splitFilter<T extends string>(raw: string | null, allowed: T[]): T[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as string[]).includes(s));
}

export function parseFilter(search: string, base: FilterState): FilterState {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return base;
  }
  const next: FilterState = { ...base };

  const q = p.get("q");
  if (q != null) next.query = q;

  const src = splitFilter<SourceKey>(p.get("src"), SOURCE_KEYS);
  if (src.length) next.sources = src;

  const tier = splitFilter<Tier>(p.get("tier"), TIER_KEYS);
  if (tier.length) next.tiers = tier;

  const budget = p.get("budget");
  if (budget != null) {
    const n = Number(budget);
    if (Number.isFinite(n)) next.maxBudget = n;
  }

  if (p.get("focus") === "1") next.focusOnly = true;
  if (p.get("showExcluded") === "1") next.hideExcluded = false;

  const sort = p.get("sort");
  if (sort && (SORT_KEYS as string[]).includes(sort)) {
    next.sort = sort as SortKey;
  }

  const cat = splitFilter<Category>(p.get("cat"), CATEGORY_KEYS);
  if (cat.length) next.categories = cat;

  const org = p.get("org");
  if (org != null) next.orgKeyword = org;

  const from = p.get("from");
  if (from != null) next.deadlineFrom = from;
  const to = p.get("to");
  if (to != null) next.deadlineTo = to;

  const tags = p.get("tags");
  if (tags)
    next.tagFilter = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  if (p.get("north") === "1") next.northOnly = true;
  if (p.get("new") === "1") next.newToday = true;

  return next;
}
```

- [ ] **Step 5: 執行確認通過**

Run: `npx vitest run src/lib/url-filter.test.ts`
Expected: PASS（含往返保真）。

- [ ] **Step 6: 型別檢查**

Run: `npm run build`
Expected: 因 `DEFAULT_FILTER` 尚未補 `northOnly`/`newToday` 會編譯失敗 → 由 Task 5 修正。本步驟只跑 `npx vitest run` 即可；型別整體驗收延後到 Task 5。
Run: `npx vitest run`
Expected: 全數 PASS。

---

## Task 4: api.ts（postRate / postShare）

**Files:**

- Modify: `src/lib/api.ts:230-233`（在 `postNote` 之後新增）

**Interfaces:**

- Consumes: 既有 `postBehavior(path, body)`（fire-and-forget）。
- Produces:
  - `export function postRate(id: string, star: number): void` → `POST /tenders/{id}/rate` body `{ star }`。
  - `export function postShare(id: string, channel: string): void` → `POST /tenders/{id}/share` body `{ channel }`。

- [ ] **Step 1: 實作（無單元測，沿用既有 fire-and-forget 模式，與 postSave/postNote 同形）**

Modify `src/lib/api.ts`，在 `postNote` 函式後新增：

```ts
/** 評價（後端 star 1..5）→ POST /tenders/{id}/rate。理由欄由前端 localStorage 佔位（後端 rationale 待 ticket）。 */
export function postRate(id: string, star: number): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/rate`, { star });
}

/** 轉發 → POST /tenders/{id}/share。channel = link/email。 */
export function postShare(id: string, channel: string): void {
  void postBehavior(`/tenders/${encodeURIComponent(id)}/share`, { channel });
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run build`
Expected: 編譯通過（注意：若 Task 5 尚未完成，整體 build 可能仍因 strings/domain 失敗；此步驟僅確認 api.ts 本身無語法/型別錯誤，可改跑 `npx tsc --noEmit -p . 2>&1 | grep api.ts` 確認 api.ts 無錯）。

---

## Task 5: strings.ts + app-data.tsx（i18n key、衍生 memo、篩選與排序、URL 同步）

> 這是把純函式接進 store 的整合任務：補齊 i18n、`DEFAULT_FILTER`、`filteredTenders` 子句、可行性排序、衍生 `feasOf`/`keywordHitsOf`、URL 同步。完成後整體 `npm run build` 才會通過。

**Files:**

- Modify: `src/i18n/strings.ts`（zh 與 en 成對新增 key）
- Modify: `src/store/app-data.tsx`（`DEFAULT_FILTER`、`filteredTenders`、衍生 memo、context value、URL 同步）

**Interfaces:**

- Consumes: `computeFeasibility`/`FeasResult`/`FeasLabels`（Task 2）、`keywordHits`（Task 1）、`serializeFilter`/`parseFilter`/`NORTH_CITIES`（Task 3）、`daysLeft`（`@/lib/format`）。
- Produces（context value 新增，供 Task 6/7/9 消費）：
  - `feasOf: (t: Tender) => FeasResult`
  - `keywordHitsOf: (t: Tender) => string[]`
  - `hardExcludeKeywords: string[]`（若 context 尚未匯出；store 內已有 `hardExclude` state，命名以實際為準）

- [ ] **Step 1: 新增 i18n key（zh 與 en 成對）**

Modify `src/i18n/strings.ts`。在 zh 區塊適當處（詳情/篩選相關 key 附近）新增：

```ts
    // 詳情：可行性 / 評價 / 轉發 / 標籤 / 待補
    feasBreakdown: "分數拆解",
    feasDefault: "依預設權重",
    matchedCount: "命中",
    rate: "評價",
    rateHint: "點星評分（理由暫存本機）",
    rationale: "評價理由",
    forward: "轉發",
    forwardLink: "複製連結",
    forwardEmail: "以 Email 轉發",
    visibility: "可見性",
    visPublic: "公開",
    visPrivate: "私人",
    pending: "待補",
    pendingDesc: "此欄位待後端 ticket 上線後自動填入",
    deliveryLocation: "履約地點",
    qualification: "資格要求摘要",
    attachments: "已下載檔案",
    similarCases: "相似歷史案",
    // 篩選：北部城市 / 當日新案 / 分享
    northOnly: "北部限定",
    newToday: "當日新案",
    shareFilter: "複製篩選連結",
    catWorks: "工程",
    catGoods: "財物",
    catServices: "勞務",
```

> 注意：`catWorks/catGoods/catServices`、`feasibility`、`keywords`、`org`、`city`、`tenderMethod`、`caseNo`、`sourcePage`、`publishedAt`、`colBudget`、`colDeadline`、`daysLeft`、`deadlinePassed`、`accept`、`skip`、`star`、`unstar` 已存在，**勿重複加**（重複 key 會編譯錯）。實作前先 `grep -n '<key>:' src/i18n/strings.ts` 確認；已存在者跳過。

在 en 區塊**對應位置**成對新增（鍵名相同，值為英文）：

```ts
    feasBreakdown: "Score breakdown",
    feasDefault: "Default weights",
    matchedCount: "Matched",
    rate: "Rate",
    rateHint: "Tap to rate (rationale stored locally)",
    rationale: "Rationale",
    forward: "Forward",
    forwardLink: "Copy link",
    forwardEmail: "Forward via email",
    visibility: "Visibility",
    visPublic: "Public",
    visPrivate: "Private",
    pending: "Pending",
    pendingDesc: "Auto-filled once the backend ticket ships",
    deliveryLocation: "Delivery location",
    qualification: "Qualification summary",
    attachments: "Downloaded files",
    similarCases: "Similar past cases",
    northOnly: "North only",
    newToday: "New today",
    shareFilter: "Copy filter link",
```

（`catWorks/catGoods/catServices` 若 en 已存在則勿重複。）

- [ ] **Step 2: 補 DEFAULT_FILTER 欄位**

Modify `src/store/app-data.tsx:40-53`，在 `tagFilter: [],` 後新增：

```ts
    northOnly: false,
    newToday: false,
```

- [ ] **Step 3: 新增 today 判斷與衍生 memo**

Modify `src/store/app-data.tsx`。在檔案上方 import 區加入：

```ts
import { daysLeft } from "@/lib/format";
import { keywordHits } from "@/lib/keyword-hits";
import {
  computeFeasibility,
  type FeasResult,
  type FeasLabels,
} from "@/lib/feasibility";
import { NORTH_CITIES, serializeFilter, parseFilter } from "@/lib/url-filter";
```

（`daysLeft` 若已 import 則勿重複。）

在 provider 內、`filteredTenders` 之前，新增 today 字串與衍生 map（注意：`hardExclude` state 變數名以檔案實際為準；下方以 `hardExclude`/`focusKeywords` 示意）：

```ts
// 可行性 breakdown 的固定標籤（中性詞；i18n 由顯示端決定，這裡用穩定鍵）
const feasLabels: FeasLabels = useMemo(
  () => ({
    works: "工程",
    goods: "財物",
    services: "勞務",
    budgetFit: "預算適配",
    deadlineFar: "截止充裕",
    deadlineMid: "截止適中",
    deadlineNear: "截止近",
    hardExcluded: "硬排除",
  }),
  [],
);

const feasMap = useMemo(() => {
  const m = new Map<string, FeasResult>();
  for (const t of tenders) {
    m.set(
      t.id,
      computeFeasibility(
        t,
        { focus: focusKeywords, hard: hardExclude },
        t.deadline ? daysLeft(t.deadline) : 0,
        feasLabels,
      ),
    );
  }
  return m;
}, [tenders, focusKeywords, hardExclude, feasLabels]);

const feasOf = useCallback(
  (t: Tender): FeasResult =>
    feasMap.get(t.id) ?? { score: t.feasibility, breakdown: [] },
  [feasMap],
);

const keywordHitsOf = useCallback(
  (t: Tender): string[] => keywordHits(t, focusKeywords),
  [focusKeywords],
);

const todayISO = new Date().toISOString().slice(0, 10);
```

- [ ] **Step 4: 加入 northOnly/newToday 篩選子句與可行性排序**

Modify `src/store/app-data.tsx:252-279` 的 `filteredTenders`：在 `tagFilter` 子句之後、`return true;` 之前新增：

```ts
if (filter.northOnly) {
  const city = t.city ?? "";
  if (!NORTH_CITIES.some((c) => city.includes(c))) return false;
}
if (filter.newToday) {
  const seen = (t.lastSeen ?? t.publishedAt ?? "").slice(0, 10);
  if (seen !== todayISO) return false;
}
```

並把結尾排序改為可行性感知：

```ts
if (filter.sort === "feasibility") {
  return list.sort((a, b) => feasOf(b).score - feasOf(a).score);
}
return list.sort(comparator(filter.sort));
```

同步更新 `useMemo` 依賴陣列為 `[tenders, filter, hasFocus, isExcluded, feasOf, todayISO]`。

- [ ] **Step 5: URL 同步（初始化 + 寫回）**

Modify `src/store/app-data.tsx`。filter 初始化改為先讀 URL（URL 優先於 localStorage）：

```ts
const [filter, setFilterState] = useState<FilterState>(() => {
  const stored = { ...DEFAULT_FILTER, ...load("filter", DEFAULT_FILTER) };
  if (typeof window !== "undefined" && window.location.search) {
    return parseFilter(window.location.search, stored);
  }
  return stored;
});
```

（若現有初始化形式不同，保留原 `load` 合併語意，僅外包 `parseFilter`。）

新增寫回 URL 的 effect（filter 變更時更新 query，不新增歷史記錄）：

```ts
useEffect(() => {
  if (typeof window === "undefined") return;
  const qs = serializeFilter(filter);
  const url = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(null, "", url);
}, [filter]);
```

- [ ] **Step 6: 匯出 feasOf / keywordHitsOf 到 context value**

Modify `src/store/app-data.tsx` 的 context type 與 value useMemo：

- 在 `AppDataValue`（或同名介面）加：

```ts
  feasOf: (t: Tender) => FeasResult;
  keywordHitsOf: (t: Tender) => string[];
```

- 在 provider value 物件加入 `feasOf, keywordHitsOf,`，並把 `feasOf`/`keywordHitsOf` 補進該 useMemo 的依賴陣列。
- 若 `hardExclude`/`focusKeywords` 尚未在 context 匯出而 Task 6/7 需要，一併匯出（命名以實際為準）。

- [ ] **Step 7: 全量型別 + 測試**

Run:

```bash
npm run build && npx vitest run
```

Expected: build 編譯通過、所有單元測 PASS。

---

## Task 6: detail-bits.tsx（新增共用展示元件）

**Files:**

- Modify: `src/components/tenders/detail-bits.tsx`（保留既有 `Fact`/`MeterRow`/`SectionLabel`，新增元件）

**Interfaces:**

- Consumes: `FeasResult`/`FeasBreakdown`（`@/lib/feasibility`）、`FeasibilityMeter`、`Badge`、`TierBadge`、`sourceByKey`、lucide `Star`、`Clock`。
- Produces（供 Task 7 消費）：
  - `LabelTags({ tender, lang })` — 來源 + 類別色標 + 城市 Badge 列。
  - `FeasibilityBadge({ result, t })` — 分數徽章 + hover tooltip 列 breakdown（空則顯示 `t("feasDefault")`）。
  - `DaysLeftBanner({ daysLeft, t })` — `<7` 天紅色警示條（含已過）。
  - `PlaceholderBlock({ label, t })` — 「待補」佔位，附 `t("pendingDesc")`。
  - `RatingStars({ value, onRate })` — 5★ 可點。

- [ ] **Step 1: 實作（純展示，無單元測；以 build + Preview 驗收）**

在 `src/components/tenders/detail-bits.tsx` 末尾新增（補對應 import）：

```tsx
import type { Lang, TextKey } from "@/i18n/strings";
import type { Category, Tender } from "@/types/domain";
import type { FeasResult } from "@/lib/feasibility";
import { Star, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/ui/tier-badge";
import { sourceByKey } from "@/data/sources";

const CAT_KEY: Record<Category, TextKey> = {
  works: "catWorks",
  goods: "catGoods",
  services: "catServices",
};
const CAT_VARIANT: Record<Category, "signal" | "muted" | "outline"> = {
  works: "signal",
  goods: "muted",
  services: "outline",
};

/** 來源 + 類別色標 + 城市 Badge 列。 */
export function LabelTags({
  tender,
  lang,
  t,
}: {
  tender: Tender;
  lang: Lang;
  t: (k: TextKey) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TierBadge tier={tender.tier} lang={lang} />
      <Badge variant="muted">{sourceByKey(tender.source).shortName}</Badge>
      <Badge variant={CAT_VARIANT[tender.category]}>
        {t(CAT_KEY[tender.category])}
      </Badge>
      {tender.city && <Badge variant="outline">{tender.city}</Badge>}
    </div>
  );
}

/** 可行性分數徽章 + hover tooltip 拆解。 */
export function FeasibilityBadge({
  result,
  t,
}: {
  result: FeasResult;
  t: (k: TextKey) => string;
}) {
  const tip = result.breakdown.length
    ? result.breakdown
        .map((b) => `${b.delta >= 0 ? "+" : ""}${b.delta} ${b.label}`)
        .join("  ")
    : t("feasDefault");
  return (
    <span
      title={`${t("feasBreakdown")}: ${tip}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-ink"
    >
      {t("feasibility")}
      <span className="tnum text-signal">{result.score}</span>
    </span>
  );
}

/** 剩餘 <7 天紅色警示條（含已過）。 */
export function DaysLeftBanner({
  daysLeft,
  t,
}: {
  daysLeft: number;
  t: (k: TextKey) => string;
}) {
  if (daysLeft >= 7) return null;
  const text =
    daysLeft < 0 ? t("deadlinePassed") : `${daysLeft} ${t("daysLeft")}`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] font-medium text-danger">
      <Clock size={14} className="shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** 「待補」佔位（後端尚未吐出的欄位）。 */
export function PlaceholderBlock({
  label,
  t,
}: {
  label: string;
  t: (k: TextKey) => string;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-2 text-[12px] text-ink-dim">
        <span className="mr-1 rounded bg-surface-2 px-1.5 py-0.5">
          {t("pending")}
        </span>
        {t("pendingDesc")}
      </div>
    </div>
  );
}

/** 5★ 可點評價。 */
export function RatingStars({
  value,
  onRate,
}: {
  value: number;
  onRate: (star: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n}`}
          onClick={() => onRate(n)}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-accent"
        >
          <Star
            size={16}
            className={
              n <= value ? "fill-tier-mid text-tier-mid" : "text-ink-dim"
            }
          />
        </button>
      ))}
    </div>
  );
}
```

> `Badge` 的 `variant` 取值（`signal`/`muted`/`outline`）以 `src/components/ui/badge.tsx` 實際支援為準；實作前 `grep -n 'variant' src/components/ui/badge.tsx` 確認，缺的改用既有變體。

- [ ] **Step 2: 型別檢查**

Run: `npm run build`
Expected: 編譯通過。

---

## Task 7: tender-drawer.tsx（寬版雙欄改寫 + 行動鈕整合）

**Files:**

- Modify: `src/components/tenders/tender-drawer.tsx`（整檔改寫，保留 export 名 `TenderDrawer` 與 props 簽章）

**Interfaces:**

- Consumes: Task 6 元件（`LabelTags`/`FeasibilityBadge`/`DaysLeftBanner`/`PlaceholderBlock`/`RatingStars`）、Task 5 的 `feasOf`/`keywordHitsOf`、Task 4 的 `postRate`/`postShare`、既有 `accept`/`skip`/`toggleStar`/`isStarred`/`addComment`/`commentsOf`。
- Produces: 不變的 `export function TenderDrawer({ tender, onClose })`。

- [ ] **Step 1: 改寫為雙欄版**

把 `tender-drawer.tsx` 改為左欄（主資訊 2/3）+ 右欄（行動 + 社群 1/3）的 grid（`grid gap-6 md:grid-cols-3`，左欄 `md:col-span-2`，手機自動單欄堆疊）。要點（保留既有 import，新增 Task 4/6 來源；新增 local state）：

- 標題列下方放 `<LabelTags tender lang t />` + `<FeasibilityBadge result={feasOf(tender)} t />` + ⭐ 儲存鈕（沿用既有 `toggleStar`）。
- 左欄：`<DaysLeftBanner daysLeft={dleft} t />`、可行性 `MeterRow`（值用 `feasOf(tender).score`）、既有事實格（org/publishedAt/budget/deadline ROC+ISO/method/性質/caseNo）、關鍵匹配（`keywordHitsOf(tender)`：`{t("matchedCount")} N` + chip）、`<PlaceholderBlock label={t("deliveryLocation")} t />` + `<PlaceholderBlock label={t("qualification")} t />` + `<PlaceholderBlock label={t("attachments")} t />` + `<PlaceholderBlock label={t("similarCases")} t />`、原文連結 + 完整詳情頁鈕（沿用既有）。
- 右欄：承接 / 略過（沿用 footer 邏輯，可移入右欄或保留 footer）、評價 `<RatingStars value={rating} onRate={...} />`（見 Step 2）、轉發兩鈕（`postShare(id,"link")` 複製連結到剪貼簿；`postShare(id,"email")`）、公開/私人 toggle（localStorage）、註記區（沿用既有 form）。

新增 local state（取代僅有的 `text`）：

```ts
const [rating, setRating] = useState(0);
const [isPublic, setIsPublic] = useState(false);
```

切換標案時（既有 `if (tender?.id !== lastTenderId)` 區塊內）一併重置：

```ts
setText("");
setRating(0);
setIsPublic(false);
```

- [ ] **Step 2: 接行為鈕（fire-and-forget + localStorage 佔位）**

在 import 加 `import { postRate, postShare } from "@/lib/api";` 與 `import { load, save } from "@/lib/storage";`。

評價：

```ts
const onRate = (star: number) => {
  if (!tender) return;
  setRating(star);
  postRate(tender.id, star);
  // 理由欄佔位：暫存本機（後端 rationale 待 ticket）
  save(`rating:${tender.id}`, { star });
};
```

轉發（複製連結用 `navigator.clipboard`，失敗靜默）：

```ts
const onForward = (channel: "link" | "email") => {
  if (!tender) return;
  postShare(tender.id, channel);
  if (channel === "link" && tender.link) {
    void navigator.clipboard?.writeText(tender.link).catch(() => {});
  }
};
```

公開/私人：

```ts
const togglePublic = () => {
  if (!tender) return;
  const next = !isPublic;
  setIsPublic(next);
  save(`visibility:${tender.id}`, next ? "public" : "private");
};
```

切換標案時初始化 `rating`/`isPublic` 從 localStorage 還原（可選）：

```ts
setRating(load<{ star: number }>(`rating:${tender.id}`, { star: 0 }).star);
setIsPublic(load<string>(`visibility:${tender.id}`, "private") === "public");
```

（放在切換標案的 `if` 區塊；`tender?.id` 為 undefined 時用空字串 key 不影響。）

- [ ] **Step 3: 型別檢查**

Run: `npm run build`
Expected: 編譯通過。

---

## Task 8: filter-bar.tsx（北部城市 / 當日新案 chip + 複製篩選連結）

**Files:**

- Modify: `src/components/tenders/filter-bar.tsx`

**Interfaces:**

- Consumes: Task 5 的 `filter.northOnly`/`filter.newToday`、`setFilter`、Task 3 的 `serializeFilter`。
- Produces: 無新 export。

- [ ] **Step 1: 加入兩個 chip 與分享鈕**

在「偏好開關」區塊（`focusOnly`/`hideExcluded` chip 附近）新增：

```tsx
      <Chip
        active={filter.northOnly}
        onClick={() => setFilter({ northOnly: !filter.northOnly })}
      >
        {t("northOnly")}
      </Chip>
      <Chip
        active={filter.newToday}
        onClick={() => setFilter({ newToday: !filter.newToday })}
      >
        {t("newToday")}
      </Chip>
```

更新 `active` 判定（第 112-124 行）加入 `|| filter.northOnly || filter.newToday`。

在右側「排序 + 清除」區塊新增複製篩選連結鈕（import `serializeFilter` 與 lucide `Link2`）：

```tsx
<Button
  variant="ghost"
  size="sm"
  title={t("shareFilter")}
  onClick={() => {
    const qs = serializeFilter(filter);
    const url = `${window.location.origin}${window.location.pathname}${qs ? "?" + qs : ""}`;
    void navigator.clipboard?.writeText(url).catch(() => {});
  }}
>
  <Link2 size={14} />
</Button>
```

- [ ] **Step 2: 型別檢查**

Run: `npm run build`
Expected: 編譯通過。

---

## Task 9: 端到端驗證（Preview MCP）

**Files:** 無（驗收）。

- [ ] **Step 1: 啟動 dev server**

用 Claude Preview MCP `preview_start`（serverId 對應 launch.json `tender-ai-dev`，runtime 為 vite dev，port 5173；**勿用** static server 8765）。確認 `preview_console_logs` 無 error。

- [ ] **Step 2: 詳情雙欄**

`preview_click` 點任一標案列 → `preview_snapshot` 確認為寬版雙欄 Dialog（左主資訊 / 右行動）；按 Esc / 點 backdrop 可關閉。

- [ ] **Step 3: 可行性與待補**

hover 可行性徽章 → tooltip 顯示 breakdown；剩餘 <7 天的標案顯示紅色 `DaysLeftBanner`；履約地點/資格/附件/相似案顯示「待補」佔位（非空白、非錯誤）。

- [ ] **Step 4: 行為鈕**

`preview_network` 監看：點 5★ → `POST /tenders/{id}/rate` 200；點轉發 → `POST /tenders/{id}/share` 200；切換公開/私人不報錯。

- [ ] **Step 5: 篩選與 URL**

點「北部限定」「當日新案」chip → `preview_snapshot` 確認列表變化；點複製篩選連結 → `preview_eval` 讀 `window.location.search` 確認帶 query；reload 後篩選狀態還原。

- [ ] **Step 6: 收尾佐證**

`preview_screenshot` 截寬版雙欄詳情與篩選列。

---

## Self-Review

**1. Spec coverage（對 `docs/superpowers/specs/2026-06-18-tender-detail-view-design.md`）**

- §3 寬版雙欄版面 → Task 7。✓
- §3 共用元件 `LabelTags/FeasibilityBadge/DaysLeftBanner/PlaceholderBlock/RatingStars` → Task 6。✓
- §4 `feasibility.ts` `computeFeasibility` + tooltip breakdown → Task 2 + Task 6 `FeasibilityBadge`。✓（純函式化：`daysLeftValue` 由呼叫端傳入，store 用 `daysLeft()`）
- §5 `keyword-hits.ts` 共用比對 → Task 1，feasibility 與顯示共用同一來源。✓
- §6 行動鈕接線：承接/略過/儲存/註記（既有沿用）、評價 `postRate`、轉發 `postShare`、公開/私人 toggle、意義標籤（命中 chip）→ Task 4 + Task 7。✓
- §7 排序 feasibility 用第 4 節分數 → Task 5（`feasOf` 排序）；北部城市/當日新案 chip → Task 8；URL query 同步 → Task 3 + Task 5。✓
- §8 資料流（render 時算、不持久化）→ store memo `feasMap`（衍生、非持久化），符合「不入持久化 store」之意圖，且供排序共用。✓（與 spec 字面「render 時算」之差異已在 Architecture 說明：改為 store 衍生 memo，避免排序與顯示邏輯分歧）
- §9 錯誤處理：寫入靜默、缺欄位 `PlaceholderBlock`、URL 解析失敗回 DEFAULT、breakdown 空顯示「依預設權重」→ Task 3/6/7。✓
- §10 測試：`computeFeasibility`/`keywordHits`/URL 往返單元測 + build → Task 1/2/3；Preview 驗收 → Task 9。✓
- §11 受影響檔案全覆蓋。✓

**2. Placeholder scan:** 各程式步驟均附完整程式碼；無 TBD/「類似 Task N」。「待補」字樣為產品需求（`PlaceholderBlock` UI），非計畫佔位。✓

**3. Type consistency:** `FeasResult`/`FeasRules`/`FeasLabels`/`FeasBreakdown` 於 Task 2 定義，Task 5/6 一致引用；`keywordHits(tender, focusRules)` 簽章於 Task 1 定義、Task 2/5 一致；`serializeFilter`/`parseFilter`/`NORTH_CITIES` 於 Task 3 定義、Task 5/8 一致；`postRate(id, star)`/`postShare(id, channel)` 於 Task 4 定義、Task 7 一致；`FilterState.northOnly/newToday` 於 Task 3 加入、Task 5/8 使用。✓

**已知前置順序風險：** Task 3 加 `FilterState` 欄位後，`DEFAULT_FILTER`（Task 5）未補前整體 build 會紅；故 Task 3 驗收以 `npx vitest run` 為主、整體 build 延到 Task 5。執行時務必照 Task 編號順序（1→2→3→4→5→6→7→8→9）。

---

## Commit 備註

此工作區非 git repo，無法 commit。各任務以 `npm run build`（型別）+ `npx vitest run`（單元測）作為驗收閘門，取代 commit step。如需版控可後續於此層 `git init` 或併入 `aiadminhq` repo。
