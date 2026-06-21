import { useRef, useState } from "react";
import { AlertTriangle, Send, StickyNote } from "lucide-react";
import type { KanbanCard } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { userById } from "@/data/users";
import { formatDate } from "@/lib/format";
import { TierBadge } from "@/components/ui/tier-badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { CardNotePopover } from "./card-note-popover";
import { CardForwardMenu } from "./card-forward-menu";

export function KanbanCardView({
  card,
  onShift,
}: {
  card: KanbanCard;
  onShift: (dir: -1 | 1) => void;
}) {
  const { t, lang } = useApp();
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<null | "notes" | "forward">(null);
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  const fwdBtnRef = useRef<HTMLButtonElement>(null);
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
        "cursor-grab rounded-md border border-border bg-surface-1 p-3 transition-[box-shadow,opacity,border-color] hover:border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:cursor-grabbing",
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
        {assignee && <Avatar user={assignee} size="sm" />}
      </div>

      {/* 標註 / 轉傳控制列。draggable 包裹並取消 dragstart，避免從控制項拖動整張卡。 */}
      <div
        draggable
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="mt-2 flex items-center gap-1 border-t border-hairline-soft pt-2"
      >
        <button
          ref={noteBtnRef}
          type="button"
          aria-label={t("cardNotes")}
          aria-expanded={panel === "notes"}
          title={t("cardNotes")}
          onClick={() => setPanel((p) => (p === "notes" ? null : "notes"))}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
            panel === "notes" && "bg-accent text-ink",
          )}
        >
          <StickyNote size={13} />
          {noteCount > 0 && (
            <span className="tnum min-w-3.5 rounded-full bg-surface-2 px-1 text-center text-[10px] font-medium text-ink">
              {noteCount}
            </span>
          )}
        </button>
        <button
          ref={fwdBtnRef}
          type="button"
          aria-label={t("cardForward")}
          aria-expanded={panel === "forward"}
          title={t("cardForward")}
          onClick={() => setPanel((p) => (p === "forward" ? null : "forward"))}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
            panel === "forward" && "bg-accent text-ink",
          )}
        >
          <Send size={13} />
        </button>
      </div>

      <CardNotePopover
        card={card}
        anchorRef={noteBtnRef}
        open={panel === "notes"}
        onClose={() => setPanel(null)}
      />
      <CardForwardMenu
        card={card}
        anchorRef={fwdBtnRef}
        open={panel === "forward"}
        onClose={() => setPanel(null)}
      />
    </div>
  );
}
