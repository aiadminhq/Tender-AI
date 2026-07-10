import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { KanbanCard } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { userById } from "@/data/users";
import { formatDate } from "@/lib/format";
import { TierBadge } from "@/components/ui/tier-badge";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function KanbanCardView({
  card,
  onShift,
}: {
  card: KanbanCard;
  onShift: (dir: -1 | 1) => void;
}) {
  const { t, lang } = useApp();
  const [dragging, setDragging] = useState(false);
  const assignee = userById(card.assignee);

  return (
    <div
      draggable
      tabIndex={0}
      role="button"
      aria-label={card.title}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onShift(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          onShift(-1);
        }
      }}
      className={cn(
        "cursor-grab rounded-lg border border-hairline bg-card p-3 shadow-soft transition-[box-shadow,opacity] hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex min-h-5 items-start justify-between gap-2">
        {card.tier ? <TierBadge tier={card.tier} lang={lang} /> : <span />}
        {card.blocked && (
          <Badge variant="warning" className="shrink-0">
            <AlertTriangle size={11} />
            {t("blocked")}
          </Badge>
        )}
      </div>
      <div className="mt-2 line-clamp-2 text-[12px] font-medium leading-snug text-ink">
        {card.title}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {card.deadline ? (
          <span className="tnum text-[11px] text-ink-dim">
            {formatDate(card.deadline, lang)}
          </span>
        ) : (
          <span />
        )}
        {assignee && <Avatar user={assignee} size="sm" />}
      </div>
    </div>
  );
}
