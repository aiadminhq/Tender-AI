import { HardHat, Package, Briefcase, type LucideIcon } from "lucide-react";
import type { Category } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { cn } from "@/lib/utils";

// 標案類別的單一事實來源：icon（形狀）＋ 顏色 token，全站共用。
// 色票刻意與總覽「類型分佈」環圈圖一致（works=signal／goods=priority／services=tier-mid），
// 讓列表色點、徽章、圖例三者對得起來。tint class 必須是靜態字串（Tailwind v4 JIT）。
export const CAT_KEY: Record<Category, TextKey> = {
  works: "catWorks",
  goods: "catGoods",
  services: "catServices",
};

export const CAT_META: Record<
  Category,
  { icon: LucideIcon; tint: string; dot: string }
> = {
  works: { icon: HardHat, tint: "bg-signal/12 text-signal", dot: "bg-signal" },
  goods: {
    icon: Package,
    tint: "bg-priority/12 text-priority",
    dot: "bg-priority",
  },
  services: {
    icon: Briefcase,
    tint: "bg-tier-mid/12 text-tier-mid",
    dot: "bg-tier-mid",
  },
};

/** 類別色標方塊：tinted 圓角底 + 該類別 icon（列表/卡片前導用，省空間、不佔欄）。 */
export function CategoryIcon({
  category,
  className,
  size = 14,
}: {
  category: Category;
  className?: string;
  size?: number;
}) {
  const m = CAT_META[category];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md",
        m.tint,
        className,
      )}
      aria-hidden
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

/** 類別 pill 徽章：icon + 類別名（詳情/抽屜標籤列用）。 */
export function CategoryBadge({
  category,
  t,
  className,
}: {
  category: Category;
  t: (k: TextKey) => string;
  className?: string;
}) {
  const m = CAT_META[category];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        m.tint,
        className,
      )}
    >
      <Icon size={12} strokeWidth={2.25} />
      {t(CAT_KEY[category])}
    </span>
  );
}
