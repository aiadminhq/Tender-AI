import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { KanbanBoard } from "@/components/kanban/kanban-board";

export function KanbanPage() {
  const { t } = useApp();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navKanban")} subtitle={t("kanbanSub")} />
      <KanbanBoard />
    </div>
  );
}
