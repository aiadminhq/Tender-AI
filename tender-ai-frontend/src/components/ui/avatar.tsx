import { cn } from "@/lib/utils";
import type { User } from "@/types/domain";

const sizeMap = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-[11px]",
  lg: "h-9 w-9 text-[13px]",
};

export function Avatar({
  user,
  size = "md",
  ring = false,
  className,
}: {
  user: Pick<User, "initials" | "color" | "name">;
  size?: keyof typeof sizeMap;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      title={user.name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
        sizeMap[size],
        ring && "ring-2 ring-canvas",
        className,
      )}
      style={{ backgroundColor: user.color }}
    >
      {user.initials}
    </span>
  );
}
