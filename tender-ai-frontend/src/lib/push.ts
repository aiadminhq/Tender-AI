// SL5 主動推播 client：對接後端 push API（皆 Layer A 安全內容、user_id 隔離）。
//   GET  /push/digest → 通知面板資料（最新一批推播卡 + 跨批次未讀數）
//   POST /push/run    → 觸發一次每日推播批次（依承標判準挑高潛力標案）
//   POST /push/read   → 標記已讀（單筆或全部）
// 契約見 tender-ai-backend/app/schemas/push.py。沿用 assistant.ts 的 API_BASE / authHeaders。
import { API_BASE } from "@/lib/api-base";
import type { Tier } from "@/types/domain";

function authHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  return key ? { "X-API-Key": key } : {};
}

// 對齊後端 PushItemOut（snake_case → camelCase）。皆為標案公開（Layer A）欄位
// 與可解釋聚合分數／理由，不含人名／email。
export interface PushItem {
  id: number;
  tenderId: number | null;
  runDate: string;
  score: number | null;
  tier: Tier | null;
  reason: string | null;
  channel: string;
  status: string;
  pushedAt: string | null;
  readAt: string | null;
  // Layer A 顯示欄位
  name: string | null;
  org: string | null;
  category: string | null;
  city: string | null;
  budgetWan: number | null;
  deadlineRoc: string | null;
  daysLeft: number | null;
  source: string | null;
  link: string | null;
}

export interface PushDigest {
  runDate: string | null;
  unread: number;
  total: number;
  items: PushItem[];
}

export interface PushRunResult extends PushDigest {
  created: number;
  skipped: number;
}

interface PushItemRaw {
  id: number;
  tender_id: number | null;
  run_date: string;
  score: number | null;
  tier: Tier | null;
  reason: string | null;
  channel: string;
  status: string;
  pushed_at: string | null;
  read_at: string | null;
  name: string | null;
  org: string | null;
  category: string | null;
  city: string | null;
  budget_wan: number | null;
  deadline_roc: string | null;
  days_left: number | null;
  source: string | null;
  link: string | null;
}

function adaptItem(r: PushItemRaw): PushItem {
  return {
    id: r.id,
    tenderId: r.tender_id,
    runDate: r.run_date,
    score: r.score,
    tier: r.tier,
    reason: r.reason,
    channel: r.channel,
    status: r.status,
    pushedAt: r.pushed_at,
    readAt: r.read_at,
    name: r.name,
    org: r.org,
    category: r.category,
    city: r.city,
    budgetWan: r.budget_wan,
    deadlineRoc: r.deadline_roc,
    daysLeft: r.days_left,
    source: r.source,
    link: r.link,
  };
}

/** 取得通知面板資料。後端未啟動／錯誤時 throw，由 UI fallback。 */
export async function fetchPushDigest(): Promise<PushDigest> {
  const res = await fetch(`${API_BASE}/push/digest`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`push digest ${res.status}`);
  const d = (await res.json()) as {
    run_date: string | null;
    unread: number;
    total: number;
    items: PushItemRaw[];
  };
  return {
    runDate: d.run_date,
    unread: d.unread,
    total: d.total,
    items: (d.items ?? []).map(adaptItem),
  };
}

/** 觸發一次每日推播批次（手動產生）。同日重跑 idempotent。 */
export async function runPush(opts?: {
  limit?: number;
  minScore?: number;
  lookbackDays?: number;
}): Promise<PushRunResult> {
  const body: Record<string, number> = {};
  if (opts?.limit != null) body.limit = opts.limit;
  if (opts?.minScore != null) body.min_score = opts.minScore;
  if (opts?.lookbackDays != null) body.lookback_days = opts.lookbackDays;

  const res = await fetch(`${API_BASE}/push/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`push run ${res.status}`);
  const d = (await res.json()) as {
    run_date: string | null;
    created: number;
    skipped: number;
    items: PushItemRaw[];
  };
  return {
    runDate: d.run_date,
    created: d.created,
    skipped: d.skipped,
    unread: d.items.filter((i) => i.status === "pending").length,
    total: d.items.length,
    items: d.items.map(adaptItem),
  };
}

/** 標記已讀。pushId 給定 → 單筆；省略 → 全部未讀。回傳更新筆數。 */
export async function markPushRead(pushId?: number): Promise<number> {
  const res = await fetch(`${API_BASE}/push/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(pushId != null ? { push_id: pushId } : {}),
  });
  if (!res.ok) throw new Error(`push read ${res.status}`);
  const d = (await res.json()) as { marked: number };
  return d.marked;
}
