import { Check } from "lucide-react";
import type { KanbanCard } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Avatar } from "@/components/ui/avatar";
import { AnchoredPopover } from "@/components/ui/anchored-popover";

// 轉傳選單（Layer B 行為資料）：把卡片改派給白名單內同事（具名）。
export function CardForwardMenu({
  card,
  anchorRef,
  open,
  onClose,
}: {
  card: KanbanCard;
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const { t, users } = useApp();
  const { forwardCard } = useAppData();

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      align="end"
      width={224}
      label={t("cardForwardTo")}
    >
      <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-tight text-ink-muted">
        {t("cardForwardTo")}
      </div>
      <ul className="space-y-0.5">
        {users.map((u) => {
          const current = card.assignee === u.id;
          return (
            <li key={u.id}>
              <button
                type="button"
                disabled={current}
                onClick={() => {
                  forwardCard(card.id, u.id);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Avatar user={u} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink">
                    {u.name}
                  </span>
                  <span className="block truncate text-[10px] text-ink-dim">
                    {current ? t("cardForwardCurrent") : u.role}
                  </span>
                </span>
                {current && (
                  <Check size={14} className="shrink-0 text-tier-high" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </AnchoredPopover>
  );
}
