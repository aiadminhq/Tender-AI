// Toolbar 箭頭按鈕：常駐在 topbar，切換「設計標註」模式（dev-only）。
// 開啟後可點畫面任一元素提建議；右上角小圓點顯示目前標註數。
import { MousePointer2 } from "lucide-react";
import { useApp } from "@/store/app-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleEnabled, useAnnotateState } from "@/lib/annotate/store";

export function AnnotationToggle() {
  const { t } = useApp();
  const { enabled, annotations } = useAnnotateState();
  const count = annotations.length;

  return (
    <Button
      variant="ghost"
      size="icon"
      data-annotate-ui
      onClick={toggleEnabled}
      aria-label={t("annToolTitle")}
      aria-pressed={enabled}
      title={t("annToolTitle")}
      className={cn(
        "relative",
        enabled && "bg-signal/12 text-signal hover:bg-signal/18",
      )}
    >
      <MousePointer2 size={16} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-signal px-1 font-num text-[10px] leading-none text-white">
          {count}
        </span>
      )}
    </Button>
  );
}
