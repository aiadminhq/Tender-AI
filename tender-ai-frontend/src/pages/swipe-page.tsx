import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";

// 雛形：由 §2 sub-agent 以滑卡牌組取代內容。
export function SwipePage() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t("swipeTitle")} subtitle={t("swipeSub")} />
    </div>
  );
}
