// 子任務新增器：標題（必填）＋描述＋指派（白名單）＋優先＋截止。
// 收合時為一條 ghost「+ 新增子任務」；展開為 inline 表單。
import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SubtaskPriority } from "@/types/domain";

export function SubtaskComposer({ projectId }: { projectId: string }) {
  const { t } = useApp();
  const { addSubtask, assignableMembers } = useAppData();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");

  function reset() {
    setTitle("");
    setDesc("");
    setAssigneeId("");
    setPriority("");
    setDue("");
  }

  function submit() {
    const tt = title.trim();
    if (!tt) return;
    addSubtask(projectId, {
      title: tt,
      description: desc.trim() || undefined,
      assigneeId: assigneeId ? Number(assigneeId) : null,
      priority: (priority || undefined) as SubtaskPriority | undefined,
      dueDate: due || null,
    });
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
      >
        <Plus size={13} /> {t("addSubtask")}
      </button>
    );
  }

  const memberOptions = [
    { value: "", label: t("unassigned") },
    ...assignableMembers.map((m) => ({ value: String(m.id), label: m.name })),
  ];
  const priorityOptions = [
    { value: "", label: t("priority") },
    { value: "low", label: t("priorityLow") },
    { value: "mid", label: t("priorityMid") },
    { value: "high", label: t("priorityHigh") },
  ];

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-1 p-2.5">
      <Input
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("subtaskTitle")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            reset();
            setOpen(false);
          }
        }}
      />
      <textarea
        value={desc}
        rows={2}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={t("subtaskDesc")}
        className="w-full resize-none rounded-md border border-input bg-surface-1 px-3 py-2 text-[12px] text-foreground outline-none transition-colors placeholder:text-ink-dim focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          value={assigneeId}
          onValueChange={setAssigneeId}
          options={memberOptions}
        />
        <Select
          value={priority}
          onValueChange={setPriority}
          options={priorityOptions}
        />
        <Input
          type="date"
          value={due}
          aria-label={t("dueDate")}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!title.trim()}
        >
          {t("addSubtask")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          {t("adminResetCancel")}
        </Button>
      </div>
    </div>
  );
}
