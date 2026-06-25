# Dashboard Patterns

Reusable layout patterns and components for building dashboards with shadcn/ui charts.

---

## KPI Card Component

A stat card with a trend indicator and optional sparkline. Uses shadcn `Card` component.

```tsx
"use client"

import { TrendingDown, TrendingUp } from "lucide-react"
import { Area, AreaChart } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartConfig, ChartContainer } from "@/components/ui/chart"

interface KpiCardProps {
  title: string
  value: string
  change: number          // percentage change, e.g. 12.5 or -3.2
  sparklineData?: { value: number }[]
}

const chartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig

export function KpiCard({ title, value, change, sparklineData }: KpiCardProps) {
  const isPositive = change >= 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`flex items-center gap-1 text-sm ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
          {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {Math.abs(change)}%
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sparklineData && (
          <ChartContainer config={chartConfig} className="mt-2 h-[40px] w-full">
            <AreaChart data={sparklineData}>
              <Area
                dataKey="value"
                type="natural"
                fill="var(--color-value)"
                fillOpacity={0.2}
                stroke="var(--color-value)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
```

### Usage

```tsx
<KpiCard
  title="Total Revenue"
  value="$45,231.89"
  change={20.1}
  sparklineData={[
    { value: 186 }, { value: 305 }, { value: 237 },
    { value: 273 }, { value: 209 }, { value: 350 },
  ]}
/>
```

---

## Stat Grid — 4-Up Metrics

A responsive grid of KPI cards for the top of a dashboard.

```tsx
export function StatGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard title="Total Revenue" value="$45,231.89" change={20.1} />
      <KpiCard title="Subscriptions" value="+2,350" change={180.1} />
      <KpiCard title="Active Users" value="+12,234" change={19.0} />
      <KpiCard title="Churn Rate" value="2.4%" change={-4.1} />
    </div>
  )
}
```

---

## Dashboard Layouts

### Overview Dashboard

Classic layout: KPI row on top, two charts side-by-side, data table below.

```tsx
export function OverviewDashboard() {
  return (
    <div className="space-y-6 p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Revenue" value="$45,231" change={20.1} />
        <KpiCard title="Users" value="12,234" change={19.0} />
        <KpiCard title="Orders" value="1,432" change={8.2} />
        <KpiCard title="Conversion" value="3.2%" change={-1.5} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {/* <RevenueChart /> */}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Users by Source</CardTitle>
          </CardHeader>
          <CardContent>
            {/* <SourceChart /> */}
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* <DataTable /> */}
        </CardContent>
      </Card>
    </div>
  )
}
```

### Analytics Dashboard

Date picker + hero chart + metric breakdown.

```tsx
export function AnalyticsDashboard() {
  return (
    <div className="space-y-6 p-6">
      {/* Header with date picker */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        {/* <DateRangePicker /> */}
      </div>

      {/* Hero Chart — full width */}
      <Card>
        <CardHeader>
          <CardTitle>Traffic Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {/* <TrafficChart /> — area or line chart */}
        </CardContent>
      </Card>

      {/* Metric Breakdown — 3 column */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>By Device</CardTitle>
          </CardHeader>
          <CardContent>
            {/* <DonutChart /> */}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By Channel</CardTitle>
          </CardHeader>
          <CardContent>
            {/* <HorizontalBarChart /> */}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Pages</CardTitle>
          </CardHeader>
          <CardContent>
            {/* <TopPagesTable /> */}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

---

## Composition Patterns

### Responsive grid classes

```
1 column:  grid grid-cols-1 gap-4
2 column:  grid grid-cols-1 gap-4 lg:grid-cols-2
3 column:  grid grid-cols-1 gap-4 md:grid-cols-3
4 column:  grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4
```

### Chart inside a Card

Always wrap charts in shadcn `Card` for consistent padding and borders:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Chart Title</CardTitle>
    <CardDescription>Jan - Jun 2024</CardDescription>
  </CardHeader>
  <CardContent>
    <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
      {/* Recharts component */}
    </ChartContainer>
  </CardContent>
  <CardFooter className="text-sm text-muted-foreground">
    Showing total visitors for the last 6 months
  </CardFooter>
</Card>
```

### Chart sizing

- KPI sparklines: `h-[40px]` — tiny inline charts
- Small cards: `min-h-[200px]` — compact view
- Standard: `min-h-[300px]` — default for most charts
- Hero charts: `min-h-[400px]` — full-width feature charts

---

## shadcn Blocks

shadcn provides pre-built dashboard blocks you can install directly:

```bash
# Install a pre-built dashboard block
npx shadcn@latest add chart-area-stacked
npx shadcn@latest add chart-bar-multiple
npx shadcn@latest add chart-pie-donut-text
```

Browse all available chart blocks at the shadcn documentation. These are complete, styled components you can drop in and customize.
