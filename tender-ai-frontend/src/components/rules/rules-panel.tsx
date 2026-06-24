import { useState } from "react";
import { Ban, CircleSlash, Settings2, Sparkles, Target } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { KeywordEditor } from "./keyword-editor";
import { RulesWorkspace } from "./rules-workspace";

export function RulesPanel() {
  const { t } = useApp();
  const { focusKeywords, avoidKeywords, hardExclude } = useAppData();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Alert
          variant="info"
          className="flex-1 rounded-lg px-3.5 py-2.5 text-ink-muted"
          icon={<Sparkles size={15} className="mt-px text-signal" />}
        >
          {t("rulesHint")}
        </Alert>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => setAdvancedOpen(true)}
        >
          <Settings2 size={14} />
          {t("advancedEdit")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KeywordEditor
          list="focus"
          title={t("focusKeywords")}
          typeTag={t("tagWeight")}
          words={focusKeywords}
          icon={Target}
          accent="signal"
        />
        <KeywordEditor
          list="avoid"
          title={t("avoidKeywords")}
          typeTag={t("tagDownrank")}
          words={avoidKeywords}
          icon={CircleSlash}
          accent="mid"
        />
        <KeywordEditor
          list="hard"
          title={t("hardExclude")}
          typeTag={t("tagAutodrop")}
          words={hardExclude}
          icon={Ban}
          accent="danger"
        />
      </div>

      <Dialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title={t("advancedEdit")}
      >
        <RulesWorkspace />
      </Dialog>
    </div>
  );
}
