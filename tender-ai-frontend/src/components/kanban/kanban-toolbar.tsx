// 看板工具列：與我相關 toggle、成員過濾、階段過濾、+ 新增專案（進「觀望」欄）。
// 過濾狀態存 boardView（tender:board:view），跨 reload 持久化。
import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BID_STAGE_ORDER, type BidStage } from "@/types/domain";
import { STAGE_LABEL_KEY } from "./stage-badge";

export function KanbanToolbar() {
  const { t } = useApp();
  const { boardView, setBoardView, assignableMembers, addProject } =
    useAppData();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const memberOptions = [
    { value: "", label: t("allMembers") },
    ...assignableMembers.map((m) => ({ value: String(m.id), label: m.name })),
  ];
  const stageOptions = [
    { value: "", label: t("allStages") },
    ...BID_STAGE_ORDER.map((s) => ({ value: s, label: t(STAGE_LABEL_KEY[s]) })),
  ];

  function submit() {
    const tt = title.trim();
    if (!tt) return;
    addProject({ title: tt, stage: "watching" });
    setTitle("");
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Switch
        checked={boardView.mineOnly}
        onCheckedChange={(v) => setBoardView({ mineOnly: v })}
        label={t("relatedToMe")}
      />
      <div className="h-4 w-px bg-hairline-soft" aria-hidden />
      <Select
        value={
          boardView.memberFilter != null ? String(boardView.memberFilter) : ""
        }
        onValueChange={(v) =>
          setBoardView({ memberFilter: v ? Number(v) : null })
        }
        options={memberOptions}
        aria-label={t("filterByMember")}
        className="h-8 w-40 text-[12px]"
      />
      <Select
        value={boardView.stageFilter ?? ""}
        onValueChange={(v) =>
          setBoardView({ stageFilter: v ? (v as BidStage) : null })
        }
        options={stageOptions}
        aria-label={t("filterByStage")}
        className="h-8 w-32 text-[12px]"
      />
      <div className="ml-auto">
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
            className="h-8 w-56 text-[12px]"
          />
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={14} /> {t("addProject")}
          </Button>
        )}
      </div>
    </div>
  );
}
