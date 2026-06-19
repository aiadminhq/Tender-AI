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
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <nav
          className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-dim"
          aria-label="breadcrumb"
        >
          <span className="font-medium">HQdesign</span>
          <span className="text-border">/</span>
          <span className="truncate">{t("crumbSection")}</span>
        </nav>
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-ink-muted">
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
