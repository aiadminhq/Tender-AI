import { Outlet } from "react-router-dom";
import { useApp } from "@/store/app-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { BottomNav } from "./bottom-nav";
import { SelectionMenu } from "@/components/selection/selection-menu";

export function AppShell() {
  const { t } = useApp();
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* 鍵盤可及性：Tab 第一站即可跳過側欄／頂列，直達主要內容（房規 a11y）。 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-primary-foreground focus:shadow-[var(--elev-overlay)]"
      >
        {t("skipToContent")}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-background px-4 pb-24 pt-5 outline-none md:px-6 md:pb-8 lg:px-8"
        >
          <Outlet />
        </main>
      </div>
      <BottomNav />
      {/* 全局選區浮動選單：框選任意文字 → 加入關鍵字／相似搜尋／問 AI。 */}
      <SelectionMenu />
    </div>
  );
}
