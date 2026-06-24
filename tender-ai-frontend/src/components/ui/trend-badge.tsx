import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// 趨勢徽章（仿 /knowvio 的 +12% 綠標）：正向 success、負向 danger。
// delta 為百分比數值；複用 Badge 的語意色，深淺色自動適配。
export function TrendBadge({
  delta,
  className,
}: {
  delta: number;
  className?: string;
}) {
  const up = delta >= 0;
  return (
    <Badge
      variant={up ? "success" : "danger"}
      className={cn("px-1.5 py-0.5 text-[10px] font-semibold", className)}
    >
      {up ? "+" : "−"}
      {Math.abs(delta)}%
    </Badge>
  );
}
