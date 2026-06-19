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
