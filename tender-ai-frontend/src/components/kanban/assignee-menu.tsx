// 指派選單（泛化自 card-forward-menu）——Issue #1 的唯一名單來源。
// 清單 = assignableMembers（僅 whitelistActive）。空清單導向設定頁。
// click-outside / Esc / fixed-anchor 互動沿用 card-forward-menu。
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Check, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Avatar } from "@/components/ui/avatar";
import type { Anchor } from "./anchor";

export function AssigneeMenu({
  value,
  onPick,
  onClose,
  position,
}: {
  value: number | null;
  onPick: (memberId: number | null) => void;
  onClose: () => void;
  position: Anchor;
}) {
  const { t } = useApp();
  const { assignableMembers } = useAppData();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("assignTo")}
      className="fixed z-50 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-[0_1px_2px_rgba(0,0,0,.06)]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="border-b border-border bg-surface-1 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink">{t("assignTo")}</h3>
      </div>
      {assignableMembers.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <p className="text-[11px] text-ink-muted">
            {t("noWhitelistMembers")}
          </p>
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              navigate("/settings");
            }}
            className="mt-2 text-[11px] font-medium text-signal hover:underline focus:underline focus:outline-none"
          >
            {t("goToMemberSettings")}
          </button>
        </div>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto p-1.5">
          {value !== null && (
            <button
              role="menuitem"
              onClick={() => {
                onPick(null);
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-ink-dim transition-colors hover:bg-surface-1 focus:bg-surface-1 focus:outline-none"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-hairline-soft text-ink-dim">
                <UserX size={12} />
              </span>
              <span className="flex-1">{t("unassign")}</span>
            </button>
          )}
          {assignableMembers.map((m) => (
            <button
              key={m.id}
              role="menuitem"
              onClick={() => {
                onPick(m.id);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-1 focus:bg-surface-1 focus:outline-none",
                value === m.id && "bg-surface-1",
              )}
            >
              <Avatar user={m} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{m.name}</div>
                <div className="truncate text-[10px] text-ink-dim">
                  {m.email ?? m.role ?? ""}
                </div>
              </div>
              {value === m.id && (
                <Check size={13} className="shrink-0 text-signal" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
