import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { KanbanCard } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { userById } from "@/data/users";
import { formatRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { AnchoredPopover } from "@/components/ui/anchored-popover";

// 卡片標註浮層（Layer B 行為資料）：白名單內具名共享、可新增/刪除自己的標註。
export function CardNotePopover({
  card,
  anchorRef,
  open,
  onClose,
}: {
  card: KanbanCard;
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const { t, lang, person } = useApp();
  const { addCardNote, removeCardNote } = useAppData();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const notes = card.notes ?? [];

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    addCardNote(card.id, text);
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      align="start"
      width={288}
      label={t("cardNotes")}
    >
      <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-tight text-ink-muted">
        {t("cardNotes")}
      </div>

      {notes.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-ink-dim">{t("cardNoteEmpty")}</p>
      ) : (
        <ul className="mb-1 max-h-56 space-y-1.5 overflow-y-auto px-1">
          {notes.map((n) => {
            const author = userById(n.authorId);
            const mine = n.authorId === person.id;
            return (
              <li
                key={n.id}
                className="rounded-md border border-hairline-soft bg-surface-1 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  {author && <Avatar user={author} size="sm" />}
                  <span className="text-[11px] font-medium text-ink">
                    {author?.name ?? n.authorId}
                  </span>
                  <span className="tnum ml-auto text-[10px] text-ink-dim">
                    {formatRelative(n.createdAt, lang)}
                  </span>
                  {mine && (
                    <button
                      type="button"
                      aria-label={t("cardNoteDelete")}
                      title={t("cardNoteDelete")}
                      onClick={() => removeCardNote(card.id, n.id)}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-dim transition-colors hover:bg-danger/12 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-snug text-ink">
                  {n.text}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-1">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter 送出，避免誤觸換行。
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={t("cardNotePlaceholder")}
          className="w-full resize-none rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] leading-snug text-ink placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-40"
          >
            {t("cardNoteSave")}
          </button>
        </div>
      </div>
    </AnchoredPopover>
  );
}
