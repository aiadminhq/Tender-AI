import { useRef, useState } from "react";
import type { KanbanCard } from "@/types/domain";
import { KanbanCardView } from "./kanban-card";
import { cn } from "@/lib/utils";

export function KanbanColumn({
  label,
  cards,
  onDropCard,
  onShift,
}: {
  label: string;
  cards: KanbanCard[];
  onDropCard: (cardId: string) => void;
  onShift: (card: KanbanCard, dir: -1 | 1) => void;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[12px] font-semibold text-ink">{label}</span>
        <span className="tnum grid h-5 min-w-5 place-items-center rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-muted">
          {cards.length}
        </span>
      </header>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setOver(false);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          const id = e.dataTransfer.getData("text/plain");
          if (id) onDropCard(id);
        }}
        className={cn(
          "flex min-h-28 flex-1 flex-col gap-2 p-2 transition-colors",
          over && "bg-accent/60",
        )}
      >
        {cards.map((card) => (
          <KanbanCardView
            key={card.id}
            card={card}
            onShift={(dir) => onShift(card, dir)}
          />
        ))}
        {cards.length === 0 && (
          <div className="grid flex-1 place-items-center rounded-md border border-dashed border-hairline-soft py-6 text-[11px] text-ink-dim">
            —
          </div>
        )}
      </div>
    </section>
  );
}
