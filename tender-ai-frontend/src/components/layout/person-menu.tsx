import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useApp } from "@/store/app-context";
import { Avatar } from "@/components/ui/avatar";

// 登入身分切換（自製下拉，無 radix）。點外側 / Esc 關閉。
export function PersonMenu() {
  const { person, users, setPerson, t } = useApp();
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
          <div className="px-2.5 py-1.5 text-[11px] text-ink-dim">
            {t("loginAs")}
          </div>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                setPerson(u.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <Avatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">
                  {u.name}
                </div>
                <div className="truncate text-[11px] text-ink-dim">
                  {u.role}
                </div>
              </div>
              {u.id === person.id && (
                <Check size={14} className="shrink-0 text-signal" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
