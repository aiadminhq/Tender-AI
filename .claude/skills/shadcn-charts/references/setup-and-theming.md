# Setup and Theming

Complete installation, import reference, and CSS variable configuration for shadcn/ui charts.

---

## Installation

Install the chart component using your project's package manager:

```bash
# pnpm
pnpm dlx shadcn@latest add chart

# npm
npx shadcn@latest add chart

# yarn
npx shadcn@latest add chart

# bun
bunx shadcn@latest add chart
```

This creates `@/components/ui/chart.tsx` and installs `recharts` as a dependency.

---

## Import Reference

### shadcn chart exports

```tsx
import {
  ChartConfig,          // Type for chart configuration object
  ChartContainer,       // Responsive wrapper, injects CSS variables
  ChartTooltip,         // Tooltip wrapper (renders inside chart)
  ChartTooltipContent,  // Default tooltip content renderer
  ChartLegend,          // Legend wrapper
  ChartLegendContent,   // Default legend content renderer
  ChartStyle,           // Injects <style> tag for colors (used internally)
} from "@/components/ui/chart"
```

### Common Recharts imports

```tsx
// Cartesian charts
import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  CartesianGrid,
  XAxis, YAxis,
  LabelList,
} from "recharts"

// Polar charts
import {
  PieChart, Pie,
  RadarChart, Radar,
  RadialBarChart, RadialBar,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Label,
} from "recharts"
```

---

## CSS Variables — Tailwind v4

For projects using Tailwind v4 with `@theme inline` in `globals.css`:

```css
@layer base {
  :root {
    --chart-1: oklch(0.646 0.222 41.116);
    --chart-2: oklch(0.6 0.118 184.714);
    --chart-3: oklch(0.398 0.07 227.334);
    --chart-4: oklch(0.828 0.189 84.429);
    --chart-5: oklch(0.769 0.188 70.08);
  }
}
```

Place this inside your existing `@layer base` block in `globals.css`, alongside the other shadcn CSS variables (like `--background`, `--foreground`, etc.).

---

## CSS Variables — Tailwind v3

For projects using Tailwind v3 with `tailwind.config.ts`:

```css
@layer base {
  :root {
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
  }

  .dark {
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
  }
}
```

These use the HSL format (`hue saturation% lightness%`) that shadcn v3 uses for all color variables.

---

## Custom Palettes

Override `--chart-1` through `--chart-5` to match your brand. Add more variables if you need more than 5 series.

### Brand colors example

```css
:root {
  --chart-1: oklch(0.55 0.2 250);   /* brand blue */
  --chart-2: oklch(0.65 0.15 160);  /* brand teal */
  --chart-3: oklch(0.75 0.12 80);   /* brand gold */
  --chart-4: oklch(0.5 0.18 300);   /* brand purple */
  --chart-5: oklch(0.6 0.2 25);     /* brand coral */
}
```

### Monochromatic palette

```css
:root {
  --chart-1: oklch(0.35 0.15 250);  /* darkest */
  --chart-2: oklch(0.45 0.13 250);
  --chart-3: oklch(0.55 0.11 250);
  --chart-4: oklch(0.65 0.09 250);
  --chart-5: oklch(0.75 0.07 250);  /* lightest */
}
```

### Warm palette

```css
:root {
  --chart-1: oklch(0.55 0.22 25);   /* red-orange */
  --chart-2: oklch(0.65 0.2 45);    /* orange */
  --chart-3: oklch(0.75 0.18 65);   /* amber */
  --chart-4: oklch(0.8 0.15 85);    /* gold */
  --chart-5: oklch(0.85 0.1 100);   /* yellow */
}
```

### Cool palette

```css
:root {
  --chart-1: oklch(0.45 0.18 250);  /* deep blue */
  --chart-2: oklch(0.5 0.15 220);   /* blue */
  --chart-3: oklch(0.55 0.14 190);  /* cyan */
  --chart-4: oklch(0.6 0.13 160);   /* teal */
  --chart-5: oklch(0.65 0.12 140);  /* green */
}
```

---

## Dark Mode Overrides

If your project supports dark mode, add separate chart variables inside `.dark`:

```css
.dark {
  --chart-1: oklch(0.75 0.18 41.116);
  --chart-2: oklch(0.7 0.1 184.714);
  --chart-3: oklch(0.55 0.06 227.334);
  --chart-4: oklch(0.85 0.15 84.429);
  --chart-5: oklch(0.8 0.15 70.08);
}
```

Dark mode charts generally need:
- Higher lightness values (0.6-0.85) for visibility against dark backgrounds
- Slightly lower chroma to avoid neon/harsh colors on dark surfaces
