import {
  BarChart3,
  Bell,
  KanbanSquare,
  Layers,
  LayoutDashboard,
  ListChecks,
  Settings,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { TextKey } from "@/i18n/strings";

export interface NavItem {
  to: string;
  key: TextKey;
  icon: LucideIcon;
  // primary=行動底欄也顯示；secondary 僅側欄顯示（避免底欄爆滿）
  primary?: boolean;
}

// 側欄全部顯示；行動底欄只取 primary。
export const NAV: NavItem[] = [
  { to: "/", key: "navOverview", icon: LayoutDashboard, primary: true },
  { to: "/tenders", key: "navTenders", icon: ListChecks, primary: true },
  { to: "/swipe", key: "navSwipe", icon: Layers, primary: true },
  { to: "/kanban", key: "navKanban", icon: KanbanSquare, primary: true },
  { to: "/insights", key: "navInsights", icon: BarChart3, primary: true },
  { to: "/push", key: "navPush", icon: Bell },
  { to: "/assistant", key: "navAssistant", icon: Sparkles },
  { to: "/rules", key: "navRules", icon: SlidersHorizontal },
  { to: "/settings", key: "settings", icon: Settings },
];
