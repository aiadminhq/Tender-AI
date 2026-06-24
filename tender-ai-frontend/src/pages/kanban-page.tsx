import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { KanbanToolbar } from "@/components/kanban/kanban-toolbar";
import { BidBoard } from "@/components/kanban/bid-board";

export function KanbanPage() {
  const { t } = useApp();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navKanban")} subtitle={t("kanbanSub")} />
      <KanbanToolbar />
      <BidBoard />
    </div>
  );
}
