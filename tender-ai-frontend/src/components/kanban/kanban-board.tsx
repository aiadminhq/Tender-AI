import type { KanbanCard, TaskStatus } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { KanbanColumn } from "./kanban-column";

const COLUMNS: { status: TaskStatus; label: TextKey }[] = [
  { status: "todo", label: "kanbanTodo" },
  { status: "doing", label: "kanbanDoing" },
  { status: "review", label: "kanbanReview" },
  { status: "done", label: "kanbanDone" },
];

const ORDER: TaskStatus[] = ["todo", "doing", "review", "done"];

export function KanbanBoard() {
  const { t } = useApp();
  const { cards, moveCard } = useAppData();

  const shift = (card: KanbanCard, dir: -1 | 1) => {
    const i = ORDER.indexOf(card.status);
    const j = i + dir;
    if (j >= 0 && j < ORDER.length) moveCard(card.id, ORDER[j]);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => (
        <KanbanColumn
          key={col.status}
          label={t(col.label)}
          cards={cards.filter((c) => c.status === col.status)}
          onDropCard={(id) => moveCard(id, col.status)}
          onShift={shift}
        />
      ))}
    </div>
  );
}
