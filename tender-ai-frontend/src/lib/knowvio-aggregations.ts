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

/**
 * 由活動事件依 kind 分到四桶（瀏覽/評分/看板/其他），回傳固定 4 段。
 * pct 為整數且總和恰好 100（total>0 時，最大餘數法修正），total=0 時全 0。
 */
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

/**
 * 由看板卡片建立 tenderId → knowvio 狀態的映射。
 * 多卡同 tenderId 取「最進階」狀態（done>review>doing>todo）；無 tenderId 的卡略過。
 */
export function statusByTenderId(
  cards: KanbanCard[],
): Map<string, KnowvioStatusKind> {
  const best = new Map<string, TaskStatus>();
  for (const c of cards) {
    if (!c.tenderId) continue;
    const cur = best.get(c.tenderId);
    if (cur === undefined || STATUS_RANK[c.status] > STATUS_RANK[cur]) {
      best.set(c.tenderId, c.status);
    }
  }
  const out = new Map<string, KnowvioStatusKind>();
  for (const [id, st] of best) out.set(id, TASK_TO_KNOWVIO[st]);
  return out;
}

/** 查映射；查無對應卡片 → notStarted。 */
export function tenderStatusKind(
  map: Map<string, KnowvioStatusKind>,
  tenderId: string,
): KnowvioStatusKind {
  return map.get(tenderId) ?? "notStarted";
}

/**
 * 趨勢序列末兩點的百分比變化字串（如 "+75%"）。
 * 長度<2 或前值=0（無真實基準）回 null —— 誠實隱藏勝過假數。
 */
export function trendDeltaPct(trend: number[]): string | null {
  if (trend.length < 2) return null;
  const prev = trend[trend.length - 2];
  const last = trend[trend.length - 1];
  if (prev === 0) return null;
  const pct = Math.round(((last - prev) / prev) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
