import { useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import type { KanbanCard, KanbanNote } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { USERS, userById } from "@/data/users";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CardNotePopover({
  card,
  onClose,
  position,
}: {
  card: KanbanCard;
  onClose: () => void;
  position: { top: number; left: number };
}) {
  const { t, lang } = useApp();
  // 作者比對沿用本地 mock 預設身分（與 app-data 寫入端一致）。
  const person = USERS[0];
  const { addCardNote, removeCardNote } = useAppData();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const notes = card.notes ?? [];

  const handleAddNote = async () => {
    if (!input.trim()) return;
    setSubmitting(true);
    try {
      addCardNote(card.id, input);
      setInput("");
      if (inputRef.current) {
        inputRef.current.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveNote = (noteId: string) => {
    removeCardNote(card.id, noteId);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("cardNotes")}
      className="fixed z-50 w-72 rounded-lg border border-border bg-popover shadow-[0_1px_2px_rgba(0,0,0,.06)]"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="flex flex-col max-h-96 overflow-hidden">
        {/* 標題 */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h3 className="text-[12px] font-semibold text-ink">
            {t("cardNotes")}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-ink-dim hover:bg-surface-1 hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        {/* 註記列表 */}
        <div className="overflow-y-auto flex-1">
          {notes.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[11px] text-ink-muted">
              {t("noData")}
            </div>
          ) : (
            <div className="space-y-2 p-2.5">
              {notes.map((note) => (
                <NoteItem
                  key={note.id}
                  note={note}
                  isAuthor={note.author === person.id}
                  lang={lang}
                  onRemove={() => handleRemoveNote(note.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 新增輸入框 */}
        <div className="border-t border-border p-2.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                handleAddNote();
              }
            }}
            placeholder={t("addCardNote")}
            className="w-full rounded border border-border bg-surface-1 px-2 py-1.5 text-[11px] placeholder:text-ink-dim focus:border-primary/60 focus:outline-none resize-none"
            rows={2}
            disabled={submitting}
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              onClick={onClose}
              className="px-2 py-1 text-[11px] font-medium rounded text-ink-dim hover:bg-surface-1 transition-colors"
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleAddNote}
              disabled={!input.trim() || submitting}
              className={cn(
                "px-2 py-1 text-[11px] font-medium rounded transition-colors",
                input.trim() && !submitting
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-surface-1 text-ink-muted cursor-not-allowed",
              )}
            >
              {t("add")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteItem({
  note,
  isAuthor,
  lang,
  onRemove,
}: {
  note: KanbanNote;
  isAuthor: boolean;
  lang: "zh" | "en";
  onRemove: () => void;
}) {
  const { t } = useApp();
  const author = userById(note.author);

  return (
    <div className="rounded border border-border bg-surface-1 p-2">
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-ink-dim">
              {author?.name || "Unknown"}
            </span>
            <span className="text-[10px] text-ink-muted">
              {formatDate(note.createdAt, lang)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink leading-relaxed break-words">
            {note.body}
          </p>
        </div>
        {isAuthor && (
          <button
            onClick={onRemove}
            className="mt-0.5 shrink-0 rounded p-0.5 text-ink-dim hover:bg-danger/12 hover:text-danger transition-colors"
            title={t("removeNote")}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
