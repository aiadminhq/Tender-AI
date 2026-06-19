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
