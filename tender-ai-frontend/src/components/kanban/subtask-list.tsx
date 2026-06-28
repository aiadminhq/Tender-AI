// 子任務清單：列出 project.subtasks + 底部新增器。
import { useApp } from "@/store/app-context";
import type { TenderProject } from "@/types/domain";
import { SubtaskRow } from "./subtask-row";
import { SubtaskComposer } from "./subtask-composer";

export function SubtaskList({ project }: { project: TenderProject }) {
  const { t } = useApp();
  return (
    <div className="space-y-0.5">
      {project.subtasks.length === 0 ? (
        <p className="px-2 py-1.5 text-[11px] text-ink-dim">
          {t("noSubtasks")}
        </p>
      ) : (
        project.subtasks.map((s) => (
          <SubtaskRow key={s.id} projectId={project.id} subtask={s} />
        ))
      )}
      <SubtaskComposer projectId={project.id} />
    </div>
  );
}
