// 子任務列：勾選完成 / 標題＋描述 / 優先＋截止 / 指派頭像（白名單）/ 刪除。
import { useRef, useState } from "react";
import { Check, Clock, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Avatar } from "@/components/ui/avatar";
import { formatDate, daysLeft, daysLeftTone } from "@/lib/format";
import type { Subtask, SubtaskPriority } from "@/types/domain";
import { AssigneeMenu } from "./assignee-menu";
import { anchorBelow, type Anchor } from "./anchor";

const PRIORITY_CLS: Record<SubtaskPriority, string> = {
  low: "bg-surface-2 text-ink-dim",
  mid: "bg-tier-mid/12 text-tier-mid",
  high: "bg-danger/12 text-danger",
};

function PriorityChip({ priority }: { priority: SubtaskPriority }) {
  const { t } = useApp();
  const label =
    priority === "high"
      ? t("priorityHigh")
      : priority === "mid"
        ? t("priorityMid")
        : t("priorityLow");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
        PRIORITY_CLS[priority],
      )}
    >
      {label}
    </span>
  );
}

export function SubtaskRow({
  projectId,
  subtask,
}: {
  projectId: string;
  subtask: Subtask;
}) {
  const { t, lang } = useApp();
  const { toggleSubtask, removeSubtask, assignSubtask, memberById } =
    useAppData();
  const [menuPos, setMenuPos] = useState<Anchor | null>(null);
  const assigneeBtnRef = useRef<HTMLButtonElement>(null);
  const assignee = memberById(subtask.assigneeId);
  const done = subtask.status === "done";
  const due = subtask.dueDate ? daysLeft(subtask.dueDate) : null;

  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={subtask.title}
        onClick={() => toggleSubtask(projectId, subtask.id)}
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
          done
            ? "border-success bg-success text-white"
            : "border-hairline hover:border-ink-dim",
        )}
      >
        {done && <Check size={11} />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[12px] leading-snug",
            done ? "text-ink-dim line-through" : "text-ink",
          )}
        >
          {subtask.title}
        </div>
        {subtask.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-muted">
            {subtask.description}
          </p>
        )}
        {(subtask.priority || subtask.dueDate) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {subtask.priority && <PriorityChip priority={subtask.priority} />}
            {subtask.dueDate && (
              <span
                className={cn(
                  "tnum inline-flex items-center gap-1 text-[10px]",
                  due !== null ? daysLeftTone(due) : "text-ink-dim",
                )}
              >
                <Clock size={10} /> {formatDate(subtask.dueDate, lang)}
              </span>
            )}
          </div>
        )}
      </div>
      <button
        ref={assigneeBtnRef}
        type="button"
        title={assignee ? assignee.name : t("unassigned")}
        aria-label={t("assign")}
        onClick={() => setMenuPos(anchorBelow(assigneeBtnRef.current, 224))}
        className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        {assignee ? (
          <Avatar user={assignee} size="sm" />
        ) : (
          <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-hairline-soft text-ink-dim transition-colors hover:border-ink-dim">
            <UserPlus size={12} />
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={t("deleteSubtask")}
        onClick={() => removeSubtask(projectId, subtask.id)}
        className="shrink-0 rounded p-1 text-ink-dim opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={12} />
      </button>
      {menuPos && (
        <AssigneeMenu
          value={subtask.assigneeId ?? null}
          position={menuPos}
          onPick={(id) => assignSubtask(projectId, subtask.id, id)}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
}
