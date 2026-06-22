// 洞察分析的純彙總層（無 React、無副作用，便於單元測試）。
// 維度鎖定 category 與 source（mock 資料皆必有；city 待 live 資料再補）。
// 金額一律取 Tender.budget（TWD）。「篩選前」= tenders（基底全集），
// 「篩選後」= filteredTenders（隨全域 filter 即時變動）。
import type { Tender, Category, SourceKey } from "@/types/domain";

/** 單一維度切片：件數／金額，以及各自佔比（0..1）。 */
export interface Slice<K extends string> {
  key: K;
  count: number;
  budget: number;
  countFrac: number;
  budgetFrac: number;
}

const CATEGORY_KEYS: Category[] = ["works", "goods", "services"];

function aggregate<K extends string>(
  tenders: Tender[],
  keys: K[],
  pick: (t: Tender) => K,
): Slice<K>[] {
  const count = new Map<K, number>();
  const budget = new Map<K, number>();
  for (const k of keys) {
    count.set(k, 0);
    budget.set(k, 0);
  }
  let totalCount = 0;
  let totalBudget = 0;
  for (const t of tenders) {
    const k = pick(t);
    // 容錯：資料出現預期外的 key 時仍納入統計，不靜默丟棄。
    if (!count.has(k)) {
      count.set(k, 0);
      budget.set(k, 0);
      keys.push(k);
    }
    count.set(k, (count.get(k) ?? 0) + 1);
    budget.set(k, (budget.get(k) ?? 0) + t.budget);
    totalCount += 1;
    totalBudget += t.budget;
  }
  return keys.map((k) => {
    const c = count.get(k) ?? 0;
    const b = budget.get(k) ?? 0;
    return {
      key: k,
      count: c,
      budget: b,
      countFrac: totalCount ? c / totalCount : 0,
      budgetFrac: totalBudget ? b / totalBudget : 0,
    };
  });
}

/** 依採購類別（工程／財物／勞務）彙總，固定三段順序。 */
export function aggregateByCategory(tenders: Tender[]): Slice<Category>[] {
  return aggregate(tenders, [...CATEGORY_KEYS], (t) => t.category);
}

/** 依資料來源彙總；僅含實際出現的來源，依金額由大到小排序。 */
export function aggregateBySource(tenders: Tender[]): Slice<SourceKey>[] {
  const present = Array.from(new Set(tenders.map((t) => t.source)));
  return aggregate(tenders, present, (t) => t.source).sort(
    (a, b) => b.budget - a.budget,
  );
}

/** 金額總和（TWD）。 */
export function totalBudget(tenders: Tender[]): number {
  return tenders.reduce((sum, t) => sum + t.budget, 0);
}

/** 篩選前後對比：件數／金額兩種保留比例。delta 為金額增減（篩選通常為負）。 */
export interface BeforeAfter {
  beforeCount: number;
  afterCount: number;
  beforeBudget: number;
  afterBudget: number;
  delta: number;
  /** 金額保留比例（%），分母為 0 時回 0。 */
  budgetRetainedPct: number;
  /** 件數保留比例（%），分母為 0 時回 0。 */
  countRetainedPct: number;
}

export function budgetBeforeAfter(
  base: Tender[],
  filtered: Tender[],
): BeforeAfter {
  const beforeBudget = totalBudget(base);
  const afterBudget = totalBudget(filtered);
  return {
    beforeCount: base.length,
    afterCount: filtered.length,
    beforeBudget,
    afterBudget,
    delta: afterBudget - beforeBudget,
    budgetRetainedPct: beforeBudget ? (afterBudget / beforeBudget) * 100 : 0,
    countRetainedPct: base.length ? (filtered.length / base.length) * 100 : 0,
  };
}
