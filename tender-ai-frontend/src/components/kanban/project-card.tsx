// 投標專案卡：分級 + 標題 + 截止日 + 子任務進度 + 負責人頭像 + 展開(子任務/註記)。
// 卡身點擊：有 tenderId → 開 TenderDrawer（Issue #2）；無則切換展開。
// 內層按鈕一律 stopPropagation，避免誤觸開抽屜。
import { useRef, useState } from "react";
import {
  ChevronDown,
  Clock,
  ListChecks,
  MessageSquare,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TierBadge } from "@/components/ui/tier-badge";
import {
  formatDate,
  formatRelative,
  daysLeft,
  daysLeftTone,
} from "@/lib/format";
import { BID_STAGE_ORDER, type TenderProject } from "@/types/domain";
import { SubtaskList } from "./subtask-list";
import { AssigneeMenu } from "./assignee-menu";
import { anchorBelow, type Anchor } from "./anchor";

function ProjectNotes({ project }: { project: TenderProject }) {
  const { t, lang } = useApp();
  const { addProjectNote, removeProjectNote } = useAppData();
  const [text, setText] = useState("");
  const notes = project.notes ?? [];

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
        <MessageSquare size={12} /> {t("cardNotes")}
        {notes.length > 0 && ` · ${notes.length}`}
      </div>
      {notes.length > 0 && (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group/note rounded bg-surface-2/60 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-ink">
                  {n.author}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="tnum text-[10px] text-ink-dim">
                    {formatRelative(n.createdAt, lang)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("memberRemove")}
                    onClick={() => removeProjectNote(project.id, n.id)}
                    className="rounded p-0.5 text-ink-dim opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/note:opacity-100"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const b = text.trim();
          if (!b) return;
          addProjectNote(project.id, b);
          setText("");
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("addNote")}
          className="h-8 text-[12px]"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!text.trim()}
        >
          {t("send")}
        </Button>
      </form>
    </div>
  );
}

export function ProjectCard({
  project,
  onOpenTender,
}: {
  project: TenderProject;
  onOpenTender: (tenderId: string) => void;
}) {
  const { t, lang } = useApp();
  const {
    subtaskProgressOf,
    memberById,
    moveProjectStage,
    updateProject,
    removeProject,
  } = useAppData();
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ownerMenuPos, setOwnerMenuPos] = useState<Anchor | null>(null);
  const ownerBtnRef = useRef<HTMLButtonElement>(null);

  const owner = memberById(project.ownerId);
  const progress = subtaskProgressOf(project);
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const due = project.deadline ? daysLeft(project.deadline) : null;
  const hasTender = !!project.tenderId;

  function activate() {
    if (hasTender) onOpenTender(project.tenderId!);
    else setExpanded((v) => !v);
  }

  function shift(dir: -1 | 1) {
    const idx = BID_STAGE_ORDER.indexOf(project.stage);
    const next = BID_STAGE_ORDER[idx + dir];
    if (next) moveProjectStage(project.id, next);
  }

  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-label={project.title}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", project.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          shift(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          shift(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          activate();
        }
      }}
      className={cn(
        "cursor-grab rounded-md border border-border bg-surface-1 p-3 transition-[box-shadow,opacity,border-color] hover:border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex min-h-5 items-start justify-between gap-2">
        {project.tier ? (
          <TierBadge tier={project.tier} lang={lang} />
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-label={t("subtasks")}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="rounded p-1 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
        >
          <ChevronDown
            size={14}
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      <div className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-snug text-ink">
        {project.title}
      </div>

      <div className="mt-2 space-y-1.5">
        {project.deadline && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <Clock size={11} className="text-ink-dim" />
            <span
              className={cn(
                "tnum",
                due !== null ? daysLeftTone(due) : "text-ink-dim",
              )}
            >
              {formatDate(project.deadline, lang)}
              {due !== null && (
                <span className="ml-1">
                  {due < 0 ? t("deadlinePassed") : `${due} ${t("daysLeft")}`}
                </span>
              )}
            </span>
          </div>
        )}
        {progress.total > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-success transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tnum text-[10px] text-ink-dim">
              {progress.done}/{progress.total}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
        >
          <ListChecks size={12} />
          {progress.total > 0
            ? t("subtaskProgress")
                .replace("{done}", String(progress.done))
                .replace("{total}", String(progress.total))
            : t("subtasks")}
        </button>
        <button
          ref={ownerBtnRef}
          type="button"
          title={owner ? owner.name : t("owner")}
          aria-label={t("owner")}
          onClick={(e) => {
            e.stopPropagation();
            setOwnerMenuPos(anchorBelow(ownerBtnRef.current, 224));
          }}
          className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
        >
          {owner ? (
            <Avatar user={owner} size="sm" />
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-hairline-soft text-ink-dim transition-colors hover:border-ink-dim">
              <UserPlus size={12} />
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div
          className="mt-2.5 border-t border-hairline-soft pt-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <SubtaskList project={project} />
          <ProjectNotes project={project} />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => removeProject(project.id)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-dim transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={11} /> {t("deleteProject")}
            </button>
          </div>
        </div>
      )}

      {ownerMenuPos && (
        <AssigneeMenu
          value={project.ownerId ?? null}
          position={ownerMenuPos}
          onPick={(id) => updateProject(project.id, { ownerId: id })}
          onClose={() => setOwnerMenuPos(null)}
        />
      )}
    </div>
  );
}
