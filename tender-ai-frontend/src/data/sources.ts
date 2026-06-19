// 資料來源連接器（mock）。PCC 為主來源、TMU 第二來源；
// TPC 未綁定、NPC 離線（示範四種連線狀態）。
import type { Source, SourceKey } from "@/types/domain";

export const SOURCES: Source[] = [
  {
    key: "PCC",
    name: "政府電子採購網",
    shortName: "採購網",
    state: "connected",
    lastSync: "2026-06-17T08:00:00+08:00",
  },
  {
    key: "TMU",
    name: "北醫聯合採購",
    shortName: "北醫",
    state: "connected",
    lastSync: "2026-06-17T07:30:00+08:00",
  },
  {
    key: "TPC",
    name: "臺北市政府採購",
    shortName: "臺北市",
    state: "unbound",
  },
  {
    key: "NPC",
    name: "新北市政府採購",
    shortName: "新北市",
    state: "offline",
    lastSync: "2026-06-15T08:00:00+08:00",
  },
];

export const sourceByKey = (key: SourceKey): Source =>
  SOURCES.find((s) => s.key === key) ?? SOURCES[0];
