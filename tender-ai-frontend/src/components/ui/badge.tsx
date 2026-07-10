import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// HQ 風標籤：柔和 tint 底（色 /12）＋ 同色文字＋ pill。
// 語意色更豐富（success / warning / danger / info / 推薦 / 最優先）但克制、面積小。
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-surface-2 text-ink-muted",
        outline: "border border-hairline text-ink-muted",
        signal: "bg-signal/12 text-signal",
        success: "bg-success/12 text-success",
        warning: "bg-warning/14 text-warning",
        danger: "bg-danger/12 text-danger",
        info: "bg-info/12 text-info",
        recommend: "bg-recommend/12 text-recommend",
        priority: "bg-priority/12 text-priority",
        muted: "bg-surface-2 text-ink-dim",
        // 強調實心 pill（如 HQ「上工」深色 pill）
        solid: "bg-primary text-primary-foreground shadow-soft",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const dotColor: Record<string, string> = {
  signal: "bg-signal",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  recommend: "bg-recommend",
  priority: "bg-priority",
};

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** 顯示前導語意色點（HQ 狀態 pill 風格）。 */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  const dotCls = variant ? dotColor[variant] : undefined;
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && dotCls && (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotCls)} />
      )}
      {children}
    </span>
  );
}
