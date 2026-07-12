import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { RequireAuth } from "@/components/layout/require-auth";
import { LoginPage } from "@/pages/login-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { TendersPage } from "@/pages/tenders-page";
import { TenderDetailPage } from "@/pages/tender-detail-page";
import { KanbanPage } from "@/pages/kanban-page";
import { RulesPage } from "@/pages/rules-page";
import { SettingsPage } from "@/pages/settings-page";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="tenders" element={<TendersPage />} />
            <Route path="tenders/:id" element={<TenderDetailPage />} />
            <Route path="kanban" element={<KanbanPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
