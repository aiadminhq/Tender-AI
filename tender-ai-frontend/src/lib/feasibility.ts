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
