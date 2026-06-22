import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange"
> {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
}

/**
 * 下拉選單（自寫，無 Radix）。
 * 包一層樣式化的原生 `<select>`——鍵盤可達、螢幕報讀友善皆由瀏覽器原生保證，
 * 比自刻 listbox 穩健。右側補 chevron，沿用 Input 的邊框/焦點語言。
 */
export function Select({
  value,
  onValueChange,
  options,
  className,
  disabled,
  ...props
}: SelectProps) {
  return (
    <div className="relative inline-flex w-full">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-surface-1 pl-3 pr-8 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-dim"
      />
    </div>
  );
}
