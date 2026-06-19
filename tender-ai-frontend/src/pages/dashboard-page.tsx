import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { PageHeader } from "@/components/layout/page-header";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { ActivityStream } from "@/components/dashboard/activity-stream";
import { TenderTable } from "@/components/tenders/tender-table";
import { MaximizableCard } from "@/components/ui/maximizable-card";
import { daysLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

// 資料來源標示：誠實反映目前是後端即時資料或 mock 示範資料。
function DataBadge({ live, label }: { live: boolean; label: string }) {
  return (
    <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-ink-muted">
      <span
        className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-tier-high" : "bg-tier-mid")}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function DashboardPage() {
  const { t } = useApp();
  const { filteredTenders, usingLiveData } = useAppData();
  // 今日焦點只放仍可投標的案：排除已過截止日者（無截止日資料者保留）。
  const focus = filteredTenders
    .filter((x) => !x.deadline || daysLeft(x.deadline) >= 0)
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title={t("navOverview")} subtitle={t("overviewSub")} />
        <DataBadge
          live={usingLiveData}
          label={usingLiveData ? t("liveData") : t("demoData")}
        />
      </div>

      <KpiRow />

      {/* 主欄＝核心任務（今日焦點清單）；側欄＝概覽輔助（類型分佈、動態）。 */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <MaximizableCard title={t("focusToday")} className="min-w-0">
          <TenderTable tenders={focus} bare />
        </MaximizableCard>

        <div className="space-y-5">
          <MaximizableCard title={t("categoryDist")}>
            <CategoryChart />
          </MaximizableCard>
          <MaximizableCard title={t("activity")}>
            <ActivityStream />
          </MaximizableCard>
        </div>
      </div>
    </div>
  );
}
