import { useRef, useState } from "react";
import { AlertTriangle, MessageSquare, Send } from "lucide-react";
import type { KanbanCard } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { userById } from "@/data/users";
import { formatDate } from "@/lib/format";
import { TierBadge } from "@/components/ui/tier-badge";
import { Avatar } from "@/components/ui/avatar";
import { CardNotePopover } from "./card-note-popover";
import { CardForwardMenu } from "./card-forward-menu";
import { cn } from "@/lib/utils";

const NOTE_POPOVER_W = 288; // w-72
const FORWARD_MENU_W = 224; // w-56

type Anchor = { top: number; left: number };

/** 依觸發按鈕的位置，算出固定定位用的座標（右緣防溢出）。 */
function anchorBelow(el: HTMLElement | null, width: number): Anchor | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.bottom + 6,
    left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
  };
}

export function KanbanCardView({
  card,
  onShift,
}: {
  card: KanbanCard;
  onShift: (dir: -1 | 1) => void;
}) {
  const { t, lang } = useApp();
  const [dragging, setDragging] = useState(false);
  const [notePos, setNotePos] = useState<Anchor | null>(null);
  const [forwardPos, setForwardPos] = useState<Anchor | null>(null);
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  const forwardBtnRef = useRef<HTMLButtonElement>(null);
  const assignee = userById(card.assignee);
  const noteCount = card.notes?.length ?? 0;

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
        "cursor-grab rounded-md border border-border bg-card p-3 shadow-xs transition-[box-shadow,opacity,border-color] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex min-h-5 items-start justify-between gap-2">
        {card.tier ? <TierBadge tier={card.tier} lang={lang} /> : <span />}
        {card.blocked && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-medium text-danger">
            <AlertTriangle size={11} />
            {t("blocked")}
          </span>
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
        <div className="flex items-center gap-1">
          <button
            ref={noteBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setForwardPos(null);
              setNotePos(anchorBelow(noteBtnRef.current, NOTE_POPOVER_W));
            }}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
            title={t("cardNotes")}
            aria-label={t("cardNotes")}
          >
            <MessageSquare size={13} />
            {noteCount > 0 && <span>{noteCount}</span>}
          </button>
          <button
            ref={forwardBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setNotePos(null);
              setForwardPos(anchorBelow(forwardBtnRef.current, FORWARD_MENU_W));
            }}
            className="rounded p-1 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
            title={t("forwardCard")}
            aria-label={t("forwardCard")}
          >
            <Send size={13} />
          </button>
        </div>
        {assignee && <Avatar user={assignee} size="sm" />}
      </div>
      {notePos && (
        <CardNotePopover
          card={card}
          position={notePos}
          onClose={() => setNotePos(null)}
        />
      )}
      {forwardPos && (
        <CardForwardMenu
          card={card}
          position={forwardPos}
          onClose={() => setForwardPos(null)}
        />
      )}
    </div>
  );
}
