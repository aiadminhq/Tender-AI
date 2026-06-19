import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";

// 雛形：由 §3 sub-agent 以共用 <AssistantChat/> 取代內容。
export function AssistantPage() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title={t("navAssistant")} subtitle={t("assistantPageSub")} />
    </div>
  );
}
