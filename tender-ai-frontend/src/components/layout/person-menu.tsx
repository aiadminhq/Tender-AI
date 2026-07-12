import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { Avatar } from "@/components/ui/avatar";

// 目前登入者 + 登出（白名單登入取代舊的 demo 身分切換下拉）。點外側 / Esc 關閉。
export function PersonMenu() {
  const { person, t } = useApp();
  const { logout } = useAuth();
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

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("loginAs")}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <Avatar user={person} size="sm" />
        <ChevronDown size={14} className="text-ink-dim" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-2.5 px-2.5 py-1.5">
            <Avatar user={person} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-ink">
                {person.name}
              </div>
              <div className="truncate text-[11px] text-ink-dim">
                {person.role}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-accent"
          >
            <LogOut size={14} className="text-ink-dim" />
            {t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
