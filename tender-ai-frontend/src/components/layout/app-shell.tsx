import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { BottomNav } from "./bottom-nav";

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
    </div>
  );
}
