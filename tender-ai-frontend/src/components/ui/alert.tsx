import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// 輕量提示框（callout）：收斂散落各處手刻的 `border-X/30 bg-X/8` 區塊。
// 沿用房規 token 與 12% 級透明度；tone 同時決定邊框/底色/文字色。
// 需要 icon 與內文色分離（如 rules 提示：橙 icon + 灰字）時，
// icon 自帶顏色 class、並用 className 覆寫 body 文字色即可。
const alertVariants = cva(
  "flex gap-2 rounded-md border px-3 py-2 text-[12px] leading-relaxed",
  {
    variants: {
      variant: {
        info: "border-signal/30 bg-signal/8 text-signal",
        danger: "border-danger/30 bg-danger/8 text-danger",
        success: "border-success/30 bg-success/8 text-success",
      },
      align: {
        start: "items-start",
        center: "items-center",
      },
    },
    defaultVariants: { variant: "info", align: "start" },
  },
);

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** 前置圖示；自帶顏色 class 時可與內文色獨立（icon 包在 shrink-0 容器內）。 */
  icon?: ReactNode;
}

export function Alert({
  className,
  variant,
  align,
  icon,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      className={cn(alertVariants({ variant, align }), className)}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </div>
  );
}
