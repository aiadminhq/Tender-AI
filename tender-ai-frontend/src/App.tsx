import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useAuth } from "@/store/auth-context";
import { AppShell } from "@/components/layout/app-shell";
import { LoginPage } from "@/pages/login-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { TendersPage } from "@/pages/tenders-page";
import { TenderDetailPage } from "@/pages/tender-detail-page";
import { KanbanPage } from "@/pages/kanban-page";
import { RulesPage } from "@/pages/rules-page";
import { DecisionReviewPage } from "@/pages/decision-review-page";
import { SettingsPage } from "@/pages/settings-page";
import { SwipePage } from "@/pages/swipe-page";
import { InsightsPage } from "@/pages/insights-page";
import { PushPage } from "@/pages/push-page";
import { AssistantPage } from "@/pages/assistant-page";
import { SearchPage } from "@/pages/search-page";
import { EvolutionPage } from "@/pages/evolution-page";
import { KnowvioDashboardPage } from "@/pages/knowvio-dashboard-page";

export default function App() {
  const { status } = useAuth();

  // 登入閘門：未驗證 → 登入頁；驗證中 → 簡單載入態；已登入／示範模式 → 進入應用。
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-signal" />
      </div>
    );
  }
  if (status === "anonymous") {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* 全螢幕獨立路由（不套 AppShell）：Knowvio 風格忠實複刻儀表板 */}
        <Route path="/knowvio" element={<KnowvioDashboardPage />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="tenders" element={<TendersPage />} />
          <Route path="tenders/:id" element={<TenderDetailPage />} />
          <Route path="swipe" element={<SwipePage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="push" element={<PushPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="evolution" element={<EvolutionPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="decisions" element={<DecisionReviewPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
