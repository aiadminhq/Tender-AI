import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/pages/dashboard-page";
import { TendersPage } from "@/pages/tenders-page";
import { TenderDetailPage } from "@/pages/tender-detail-page";
import { KanbanPage } from "@/pages/kanban-page";
import { RulesPage } from "@/pages/rules-page";
import { SettingsPage } from "@/pages/settings-page";
import { SwipePage } from "@/pages/swipe-page";
import { InsightsPage } from "@/pages/insights-page";
import { PushPage } from "@/pages/push-page";
import { AssistantPage } from "@/pages/assistant-page";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="tenders" element={<TendersPage />} />
          <Route path="tenders/:id" element={<TenderDetailPage />} />
          <Route path="swipe" element={<SwipePage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="push" element={<PushPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
