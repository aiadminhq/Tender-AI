import { NavLink } from "react-router-dom";
import { useApp } from "@/store/app-context";
import { NAV } from "./nav-items";
import { cn } from "@/lib/utils";

// 行動裝置底部導覽（取代側欄）。
export function BottomNav() {
  const { t } = useApp();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface-1/95 backdrop-blur md:hidden">
      {NAV.filter((item) => item.primary).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
              isActive ? "text-signal" : "text-ink-dim",
            )
          }
        >
          <item.icon size={19} strokeWidth={2} />
          {t(item.key)}
        </NavLink>
      ))}
    </nav>
  );
}
