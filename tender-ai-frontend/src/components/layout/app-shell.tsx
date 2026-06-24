import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { BottomNav } from "./bottom-nav";
import { SelectionMenu } from "@/components/selection/selection-menu";

export function AppShell() {
  return (
    <div className="flex min-h-svh bg-canvas text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-8 lg:px-8">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      {/* 全局選區浮動選單：框選任意文字 → 加入關鍵字／相似搜尋／問 AI。 */}
      <SelectionMenu />
    </div>
  );
}
