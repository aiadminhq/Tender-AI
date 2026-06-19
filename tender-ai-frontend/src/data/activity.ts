// 即時動態（mock）。時間遞減，皆為今日（2026-06-17）事件。
import type { ActivityItem } from "@/types/domain";

export const ACTIVITY: ActivityItem[] = [
  {
    id: "a-008",
    at: "2026-06-17T14:02:00+08:00",
    userId: "u-jamie",
    kind: "comment",
    target: "資訊機房空調與環境改善",
  },
  {
    id: "a-007",
    at: "2026-06-17T13:20:00+08:00",
    userId: "u-aaron",
    kind: "accept",
    target: "實驗室給排水與衛浴改善",
  },
  {
    id: "a-006",
    at: "2026-06-17T11:12:00+08:00",
    userId: "u-christian",
    kind: "rule",
    target: "新增避免關鍵字「外牆」",
  },
  {
    id: "a-005",
    at: "2026-06-17T10:40:00+08:00",
    userId: "u-aaron",
    kind: "skip",
    target: "校舍外牆拉皮防水工程",
  },
  {
    id: "a-004",
    at: "2026-06-17T10:05:00+08:00",
    userId: "u-jamie",
    kind: "move",
    target: "仁愛院區衛浴汰換 → 審核中",
  },
  {
    id: "a-003",
    at: "2026-06-17T09:32:00+08:00",
    userId: "u-david",
    kind: "comment",
    target: "醫療大樓男女廁無障礙改善",
  },
  {
    id: "a-002",
    at: "2026-06-17T09:15:00+08:00",
    userId: "u-christian",
    kind: "accept",
    target: "臺大醫院公廁整修統包工程",
  },
  {
    id: "a-001",
    at: "2026-06-17T08:47:00+08:00",
    userId: "u-christian",
    kind: "import",
    target: "PCC 每日匯入 · 14 筆新案",
  },
];
