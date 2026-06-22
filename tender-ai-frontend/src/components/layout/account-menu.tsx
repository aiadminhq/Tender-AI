import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { authDisplay } from "@/lib/auth-api";
import { Avatar } from "@/components/ui/avatar";

// 登入身分選單（取代示範用的切換器）。顯示已登入帳號 + 帳號設定 / 登出。
// 示範模式則標示「示範模式」並提供「前往登入」。自製下拉，點外側 / Esc 關閉。
export function AccountMenu() {
  const { t } = useApp();
  const { user, isMock, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const display = authDisplay(user);
  const roleLabel = isMock
    ? t("accountMockBadge")
    : isAdmin
      ? t("adminRoleAdmin")
      : t("adminRoleMember");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={display.name}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <Avatar user={display} size="sm" />
        <ChevronDown size={14} className="text-ink-dim" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-60 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar user={display} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-ink">
                {display.name}
              </div>
              <div className="truncate text-[11px] text-ink-dim">
                {user.email ?? roleLabel}
              </div>
            </div>
          </div>
          <div className="my-1 h-px bg-border" />

          {!isMock && (
            <button
              onClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-accent"
            >
              <Settings size={14} className="text-ink-dim" />
              {t("accountMenuSettings")}
            </button>
          )}

          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-accent"
          >
            <LogOut size={14} className="text-ink-dim" />
            {isMock ? t("accountExitMock") : t("accountMenuLogout")}
          </button>
        </div>
      )}
    </div>
  );
}
