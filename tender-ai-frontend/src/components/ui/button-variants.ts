import { cva } from "class-variance-authority";

// 主行動 = 白 pill（primary）；其餘為「抬升非變色」的中性表面。
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium outline-none transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out-quart hover:-translate-y-px active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring/45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[var(--elev-rest)] hover:bg-primary/90 hover:shadow-[var(--elev-hover)]",
        secondary:
          "border border-border bg-secondary text-secondary-foreground shadow-[var(--elev-rest)] hover:bg-accent hover:shadow-[var(--elev-hover)]",
        outline:
          "border border-border bg-transparent text-foreground shadow-[var(--elev-rest)] hover:bg-accent hover:shadow-[var(--elev-hover)]",
        // ghost = 純文字鈕，保持全平（無抬升、無陰影），只換底色。
        ghost:
          "text-ink-muted hover:translate-y-0 hover:bg-accent hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--elev-rest)] hover:bg-destructive/90 hover:shadow-[var(--elev-hover)]",
      },
      size: {
        sm: "h-8 px-3 text-[12px]",
        md: "h-9 px-4 text-[13px]",
        lg: "h-10 px-5 text-[14px]",
        icon: "h-9 w-9 rounded-md",
        "icon-sm": "h-8 w-8 rounded-md",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);
