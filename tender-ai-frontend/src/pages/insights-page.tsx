import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";

// 雛形：由 §3 sub-agent 以全尺寸分析面板（Bento）取代內容。
export function InsightsPage() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navInsights")} subtitle={t("insightsSub")} />
    </div>
  );
}
