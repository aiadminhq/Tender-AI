import { cva } from "class-variance-authority";

// 主行動 = 白 pill（primary）；其餘為「抬升非變色」的中性表面。
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium outline-none transition-[transform,background-color,border-color,color] active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-soft hover:bg-primary/90",
        // 品牌主行動（HQ 朱紅）：hero CTA / 關鍵動作。
        brand:
          "bg-brand text-white shadow-soft hover:bg-[var(--brand-hover)]",
        secondary:
          "border border-hairline bg-secondary text-secondary-foreground shadow-soft hover:bg-accent",
        outline:
          "border border-hairline bg-transparent text-foreground hover:bg-accent",
        ghost: "text-ink-muted hover:bg-accent hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90",
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
