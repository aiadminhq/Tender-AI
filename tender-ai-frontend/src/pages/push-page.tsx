import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";

// 雛形：由 §3 sub-agent 以共用 <PushList/> 取代內容。
export function PushPage() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title={t("navPush")} subtitle={t("pushPageSub")} />
    </div>
  );
}
