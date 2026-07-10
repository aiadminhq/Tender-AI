import type { ReactNode } from "react";
import { useApp } from "@/store/app-context";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const { t } = useApp();
  return (
    <div className="mb-7 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <nav
          className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-dim"
          aria-label="breadcrumb"
        >
          <span className="text-ink-muted">HQdesign</span>
          <span className="text-hairline">/</span>
          <span className="truncate text-ink-dim">{t("crumbSection")}</span>
        </nav>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 truncate text-[13px] font-medium text-ink-muted">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
