// Auto-authored entry for /design-sync — committed, portable across machines.
//
// Why this file exists: tender-ai-frontend is a Vite *application*, not a
// self-installed package. The design-sync converter resolves PKG_DIR by walking
// up from the entry file to the nearest package.json with a name; pointing it
// here makes PKG_DIR = tender-ai-frontend. It also bundles every export below
// into window.TenderUI.*, so designs can compose sub-parts (CardHeader,
// ChartTooltip, …) even though only the logical components get preview cards.
//
// Regenerate / extend: add a re-export when a new src/components/ui/* component
// should be available to the design agent, then re-run the sync.
import type { ReactNode } from "react";

export { AppProvider } from "./src/store/app-context";
export { Alert } from "./src/components/ui/alert";
export { Avatar } from "./src/components/ui/avatar";
export { Badge } from "./src/components/ui/badge";
export { Button } from "./src/components/ui/button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./src/components/ui/card";
export {
  CategoryBadge,
  CategoryIcon,
} from "./src/components/ui/category-badge";
export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
} from "./src/components/ui/chart";
export { Dialog } from "./src/components/ui/dialog";
export { FeasibilityMeter } from "./src/components/ui/feasibility-meter";
export { Input } from "./src/components/ui/input";
export { MaximizableCard } from "./src/components/ui/maximizable-card";
export { Select } from "./src/components/ui/select";
export { Separator } from "./src/components/ui/separator";
export { Sheet } from "./src/components/ui/sheet";
export { BarSpark, LineSpark, StreakDots } from "./src/components/ui/sparkline";
export { Switch } from "./src/components/ui/switch";
export { Tabs } from "./src/components/ui/tabs";
export { TierBadge } from "./src/components/ui/tier-badge";
export { TrendBadge } from "./src/components/ui/trend-badge";

/**
 * Wraps every rendered preview/floor card in the app's default **light** theme.
 * The app's theme switches via the [data-theme] attribute (default light — see
 * index.html pre-paint + storage.loadTheme), and the CSS-variable tokens resolve
 * off a [data-theme="light"] ancestor — so previews need this wrapper to match
 * what users actually see.
 */
export function ThemeProvider({ children }: { children?: ReactNode }) {
  return (
    <div
      data-theme="light"
      style={{
        background: "var(--canvas)",
        color: "var(--ink)",
        padding: 24,
        borderRadius: 16,
        fontFamily: "'Inter', 'Noto Sans TC', sans-serif",
      }}
    >
      {children}
    </div>
  );
}
