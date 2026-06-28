// 投標階段欄：標頭 StageBadge + 計數，拖放換階段，底部 inline「+ 新增專案」。
// 拖放沿用 kanban-column 的 depth-counter（避免子元素 dragleave 抖動）。
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Input } from "@/components/ui/input";
import type { BidStage } from "@/types/domain";
import { ProjectCard } from "./project-card";
import { StageBadge } from "./stage-badge";

export function ProjectColumn({
  stage,
  onOpenTender,
}: {
  stage: BidStage;
  onOpenTender: (tenderId: string) => void;
}) {
  const { t, lang } = useApp();
  const { projectsByStage, moveProjectStage, addProject } = useAppData();
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const depth = useRef(0);
  const projects = projectsByStage[stage];

  function submit() {
    const tt = title.trim();
    if (!tt) return;
    addProject({ title: tt, stage });
    setTitle("");
    setAdding(false);
  }

  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <StageBadge stage={stage} lang={lang} />
        <span className="tnum grid h-5 min-w-5 place-items-center rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-muted">
          {projects.length}
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
          if (id) moveProjectStage(id, stage);
        }}
        className={cn(
          "flex min-h-28 flex-1 flex-col gap-2 p-2 transition-colors",
          over && "bg-accent/60",
        )}
      >
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpenTender={onOpenTender} />
        ))}
        {projects.length === 0 && (
          <div className="grid flex-1 place-items-center rounded-md border border-dashed border-hairline-soft py-6 text-[11px] text-ink-dim">
            {t("noProjectsInStage")}
          </div>
        )}
      </div>
      <footer className="border-t border-border p-2">
        {adding ? (
          <Input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("newProjectTitle")}
            onBlur={() => {
              if (!title.trim()) setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                setTitle("");
                setAdding(false);
              }
            }}
            className="h-8 text-[12px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
          >
            <Plus size={13} /> {t("addProject")}
          </button>
        )}
      </footer>
    </section>
  );
}
