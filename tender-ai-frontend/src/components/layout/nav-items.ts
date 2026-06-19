import {
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { TextKey } from "@/i18n/strings";

export interface NavItem {
  to: string;
  key: TextKey;
  icon: LucideIcon;
}

// 五主視圖：戰情總覽 / 標案清單 / 投標看板 / 規則設定 / 設定
export const NAV: NavItem[] = [
  { to: "/", key: "navOverview", icon: LayoutDashboard },
  { to: "/tenders", key: "navTenders", icon: ListChecks },
  { to: "/kanban", key: "navKanban", icon: KanbanSquare },
  { to: "/rules", key: "navRules", icon: SlidersHorizontal },
  { to: "/settings", key: "settings", icon: Settings },
];
