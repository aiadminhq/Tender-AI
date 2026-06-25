---
name: shadcn-charts
description: Install and build production-ready charts, dashboards, and data widgets using shadcn/ui chart components and Recharts. Use when user asks to "add charts," "build a dashboard," "data visualization," "shadcn charts," "recharts," "KPI widgets," or "analytics UI." For general UI design, see frontend-design.
---

You are an expert at building polished, accessible data visualizations using shadcn/ui chart components and Recharts. You produce production-ready charts that follow shadcn conventions: CSS-variable-driven theming, responsive containers, proper accessibility, and clean composition.

## Before You Start

Run through this checklist before writing any chart code:

1. **shadcn initialized?** — Verify `components.json` exists in the project root. If not, run `npx shadcn@latest init` first.
2. **Package manager** — Check for `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, or default to `npm`. Use the correct `dlx` command throughout.
3. **Tailwind version** — Look for `tailwind.config.ts` (v3) or `@theme inline` in `globals.css` (v4). This determines how chart CSS variables are added.
4. **Chart component installed?** — Check if `@/components/ui/chart.tsx` exists. If not, install it in the next step.

## Installation

Install the shadcn chart component:

```bash
# pnpm (adapt for npm/yarn/bun)
pnpm dlx shadcn@latest add chart
```

This installs `recharts` as a dependency and creates `@/components/ui/chart.tsx`, which exports:

- `ChartContainer` — responsive wrapper that injects CSS color variables
- `ChartTooltip` + `ChartTooltipContent` — themed tooltips
- `ChartLegend` + `ChartLegendContent` — themed legends
- `ChartConfig` type — maps data keys to labels and colors
- `ChartStyle` — injects `<style>` tag for chart colors

After installation, add chart color CSS variables to your `globals.css`. See [references/setup-and-theming.md](references/setup-and-theming.md) for complete setup for both Tailwind v3 and v4.

## Core Architecture

Every shadcn chart follows a 3-piece pattern:

### 1. ChartConfig — define your data series

```tsx
import { type ChartConfig } from "@/components/ui/chart"

const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "var(--chart-1)",
  },
  expenses: {
    label: "Expenses",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig
```

### 2. ChartContainer — responsive wrapper

Wraps the Recharts component, injects CSS variables from the config, and handles responsive sizing.

### 3. Recharts components — render directly inside

No abstraction layer. Use standard Recharts components (`BarChart`, `Bar`, `XAxis`, etc.) directly inside `ChartContainer`.

### Complete Example — Bar Chart

```tsx
"use client"

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const data = [
  { month: "Jan", revenue: 186, expenses: 80 },
  { month: "Feb", revenue: 305, expenses: 200 },
  { month: "Mar", revenue: 237, expenses: 120 },
  { month: "Apr", revenue: 273, expenses: 190 },
  { month: "May", revenue: 209, expenses: 130 },
  { month: "Jun", revenue: 214, expenses: 140 },
]

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-2)" },
} satisfies ChartConfig

export function RevenueChart() {
  return (
    <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
        <Bar dataKey="expenses" fill="var(--color-expenses)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
```

## Chart Type Selection

| Type | Best For | Key Recharts Component |
|------|----------|----------------------|
| Area | Trends, volume over time | `AreaChart` + `Area` |
| Bar | Comparisons, categories | `BarChart` + `Bar` |
| Line | Time series, multi-metric | `LineChart` + `Line` |
| Pie | Composition, parts-of-whole | `PieChart` + `Pie` |
| Radar | Multi-dimensional comparison | `RadarChart` + `Radar` |
| Radial | Progress, gauges | `RadialBarChart` + `RadialBar` |

See [references/chart-types.md](references/chart-types.md) for complete copy-paste templates for each type with multiple variants.

## Polish Checklist

Apply these standards to every chart for production quality:

- **Accessibility**: Add `accessibilityLayer` prop to the root chart component
- **Grid**: Use `<CartesianGrid vertical={false} />` for clean horizontal gridlines
- **Bars**: Add `radius={4}` for rounded corners
- **Tooltips**: Always include `<ChartTooltip content={<ChartTooltipContent />} />`
- **Legends**: Add `<ChartLegend content={<ChartLegendContent />} />` when showing multiple series
- **Colors**: Use CSS variables only (`var(--color-{key})`) — never hardcoded hex values
- **Responsive**: Wrap in `ChartContainer` with `className="min-h-[300px] w-full"`
- **Axes**: Use `tickLine={false} axisLine={false} tickMargin={10}` on XAxis for clean appearance
- **Formatting**: Use `tickFormatter` on axes for currency, percentages, or abbreviations

## Dashboard Composition

When building dashboards, combine charts with KPI cards, stat grids, and responsive layouts.

Key patterns:
- **KPI card + sparkline**: Stat number with trend indicator and inline mini-chart
- **Grid layouts**: Use `grid grid-cols-2 lg:grid-cols-4 gap-4` for metric cards
- **Chart grids**: Use `grid grid-cols-1 lg:grid-cols-2 gap-6` for chart pairs

See [references/dashboard-patterns.md](references/dashboard-patterns.md) for complete layout templates and KPI card components.

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Chart not rendering | Missing `ChartContainer` wrapper | Wrap Recharts component in `<ChartContainer config={...}>` |
| Colors not applying | CSS variables not in globals.css | Add `--chart-1` through `--chart-5` variables (see setup guide) |
| Tooltip not showing | `ChartTooltip` outside chart | Place `<ChartTooltip>` inside the chart component, not outside |
| Chart not responsive | Fixed width/height on Recharts | Remove explicit width/height; let `ChartContainer` handle sizing |
| Type errors on config | Missing `satisfies ChartConfig` | Add `satisfies ChartConfig` to the config object |
| Colors wrong in tooltip | Config keys don't match dataKeys | Ensure `chartConfig` keys exactly match `dataKey` props on chart elements |

## Related Skills

- **frontend-design** — For overall aesthetic direction, layout composition, and UI polish beyond charts
