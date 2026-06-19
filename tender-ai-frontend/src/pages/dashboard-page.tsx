import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { PageHeader } from "@/components/layout/page-header";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { ActivityStream } from "@/components/dashboard/activity-stream";
import { TenderTable } from "@/components/tenders/tender-table";
import { MaximizableCard } from "@/components/ui/maximizable-card";
import { daysLeft } from "@/lib/format";

export function DashboardPage() {
  const { t } = useApp();
  const { filteredTenders } = useAppData();
  // 今日焦點只放仍可投標的案：排除已過截止日者（無截止日資料者保留）。
  const focus = filteredTenders
    .filter((x) => !x.deadline || daysLeft(x.deadline) >= 0)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navOverview")} subtitle={t("overviewSub")} />
      <KpiRow />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-5">
          <MaximizableCard title={t("categoryDist")}>
            <CategoryChart />
          </MaximizableCard>
          <MaximizableCard title={t("focusToday")}>
            <TenderTable tenders={focus} bare />
          </MaximizableCard>
        </div>
        <MaximizableCard title={t("activity")}>
          <ActivityStream />
        </MaximizableCard>
      </div>
    </div>
  );
}
