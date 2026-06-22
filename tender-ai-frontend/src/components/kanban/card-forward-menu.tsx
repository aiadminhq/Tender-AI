import { useRef, useEffect } from "react";
import type { KanbanCard } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { USERS } from "@/data/users";
import { Avatar } from "@/components/ui/avatar";

export function CardForwardMenu({
  card,
  onClose,
  position,
}: {
  card: KanbanCard;
  onClose: () => void;
  position: { top: number; left: number };
}) {
  const { t } = useApp();
  const { forwardCard } = useAppData();
  const menuRef = useRef<HTMLDivElement>(null);

  const availableUsers = USERS.filter((u) => u.id !== card.assignee);

  const handleForwardTo = (userId: string) => {
    forwardCard(card.id, userId);
    onClose();
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("forwardTo")}
      className="fixed z-50 w-56 rounded-lg border border-border bg-popover shadow-[0_1px_2px_rgba(0,0,0,.06)] overflow-hidden"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {/* 菜單標題 */}
      <div className="border-b border-border px-3 py-2 bg-surface-1">
        <h3 className="text-[12px] font-semibold text-ink">{t("forwardTo")}</h3>
      </div>

      {/* 使用者清單 */}
      <div className="max-h-64 overflow-y-auto">
        {availableUsers.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-[11px] text-ink-muted px-3">
            {t("noData")}
          </div>
        ) : (
          <div className="space-y-0.5 p-1.5">
            {availableUsers.map((user) => (
              <button
                key={user.id}
                role="menuitem"
                onClick={() => handleForwardTo(user.id)}
                className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-1 focus:bg-surface-1 focus:outline-none"
              >
                <Avatar user={user} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink truncate">
                    {user.name}
                  </div>
                  <div className="text-[10px] text-ink-dim truncate">
                    {user.role}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
