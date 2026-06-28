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
import { OpsPanelsPage } from "@/pages/ops-panels-page";
import { DesignSystemPage } from "@/pages/design-system";
import { ChartsPage } from "@/pages/charts-page";
import { AssistantStudioPage } from "@/pages/assistant-studio-page";
import { AnnotationLayer } from "@/components/annotate/annotation-layer";

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
        {/* 操作面板組件庫展示（dev-only，獨立全螢幕，不套 AppShell） */}
        {import.meta.env.DEV && (
          <Route path="/ops-panels" element={<OpsPanelsPage />} />
        )}
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
          {/* 設計系統展示頁（dev-only，正式 build 不含） */}
          {import.meta.env.DEV && (
            <Route path="design-system" element={<DesignSystemPage />} />
          )}
          {/* 小助手替代方案 mockup（dev-only，不影響現有 /assistant） */}
          {import.meta.env.DEV && (
            <Route path="assistant-studio" element={<AssistantStudioPage />} />
          )}
          {/* 圖表藝廊（dev-only，正式 build 不含） */}
          {import.meta.env.DEV && (
            <Route path="charts" element={<ChartsPage />} />
          )}
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
      {/* 全站設計標註層（dev-only）：掛在 Routes 外，涵蓋所有路由 */}
      {import.meta.env.DEV && <AnnotationLayer />}
    </BrowserRouter>
  );
}
