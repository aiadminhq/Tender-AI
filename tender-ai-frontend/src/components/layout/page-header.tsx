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
    <div className="mb-7 flex items-end justify-between gap-4 rounded-xl bg-gradient-to-r from-primary/5 via-transparent to-signal/5 px-5 py-5">
      <div className="min-w-0">
        <nav
          className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-dim"
          aria-label="breadcrumb"
        >
          <span className="text-ink-muted">HQdesign</span>
          <span className="text-border/60">/</span>
          <span className="truncate text-ink-dim">{t("crumbSection")}</span>
        </nav>
        <h1 className="text-[21px] font-bold tracking-tight bg-gradient-to-r from-ink via-ink to-ink/80 bg-clip-text text-transparent">
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
