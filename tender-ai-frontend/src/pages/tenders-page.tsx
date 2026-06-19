import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/tenders/filter-bar";
import { TenderTable } from "@/components/tenders/tender-table";

export function TendersPage() {
  const { t } = useApp();
  const { filteredTenders } = useAppData();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navTenders")} subtitle={t("tendersSub")} />
      <FilterBar />
      <TenderTable tenders={filteredTenders} />
    </div>
  );
}
