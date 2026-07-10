# Design System Inspired by Firecrawl

## 1. Visual Theme & Atmosphere

> [!NOTE]
> **AI Analysis Required**: Review the extracted tokens below and describe the site's overall design philosophy, emotional tone, and core visual metaphors.

## 2. Color Palette & Roles

### Primary
- **Canvas Background**: `color(display-p3 0.929412 0.929412 0.929412)`
- **Secondary Surface**: `color(display-p3 0 0 0 / 0.039216)`

### Accent & Interactive
- **Primary Accent**: `#0071e3`

### Text & Neutrals
- **Text Tier 1**: `color(display-p3 0.14902 0.14902 0.14902)`
- **Text Tier 2**: `color(display-p3 1 1 1)`
- **Text Tier 3**: `color(display-p3 0.14902 0.14902 0.14902 / 0.560784)`
- **Text Tier 4**: `color(display-p3 0.14902 0.14902 0.14902 / 0.4)`

## 3. Typography Rules

### Hierarchy

| Role     | Font   | Size | Weight | Line Height |
| -------- | ------ | ---- | ------ | ----------- |
| Link (a) | suisse | 16px | 400    | 24px        |
| Body (p) | suisse | 14px | 400    | 20px        |

> [!NOTE]
> **AI Analysis Required**: Analyze the font scale, letter-spacing, and casing rules based on the visual evidence.

## 4. Component Stylings

### Buttons

**Variant 1**
- Background: `color(display-p3 0 0 0 / 0.039216)`, Text: `color(display-p3 0.14902 0.14902 0.14902)`, Radius: `12px`

**Variant 2**
- Background: `color(display-p3 0 0 0 / 0.039216)`, Text: `color(display-p3 0.14902 0.14902 0.14902)`, Radius: `10px`

**Variant 3**
- Background: `color(display-p3 0.9816 0.3634 0.0984)`, Text: `color(display-p3 1 1 1)`, Radius: `10px`

**Variant 4**
- Background: `color(display-p3 0.9816 0.3634 0.0984)`, Text: `color(display-p3 1 1 1)`, Radius: `8px`

### Shape & Border Radius Scale
- **Radiuses in use**: `12px`, `10px`, `8px`, `20px`, `999px`, `16px`

> [!NOTE]
> **AI Analysis Required**: Detail how cards and containers are styled (borders, fills, padding).

## 5. Layout Principles

> [!NOTE]
> **AI Analysis Required**: Define the max-width containers, column grid patterns, and whitespace philosophy (e.g., tight/dense vs. airy/cinematic).

## 6. Depth & Elevation

| Level   | Treatment                                                    | Suggested Use       |
| ------- | ------------------------------------------------------------ | ------------------- |
| Level 0 | Flat canvas                                                  | Base background     |
| Level 1 | `color(display-p3 0.9804 0.1127 0.098 / 0.2) 0px -6px 12px 0px inset, color(display-p3 0.9804 0.3647 0.098 / 0.12) 0px 2px 4px 0px, color(display-p3 0.9804 0.3647 0.098 / 0.12) 0px 1px 1px 0px, color(display-p3 0.9804 0.3647 0.098 / 0.16) 0px 0.5px 0.5px 0px, color(display-p3 0.9804 0.3647 0.098 / 0.2) 0px 0.25px 0.25px 0px` | Popovers, dropdowns |
| Level 2 | `rgba(0, 0, 0, 0.02) 0px 6px 12px 0px inset, rgba(0, 0, 0, 0.02) 0px 0.75px 0.75px 0px inset, rgba(0, 0, 0, 0.04) 0px 0.25px 0.25px 0px inset` | Popovers, dropdowns |
| Level 3 | `rgba(0, 0, 0, 0.04) 0px 6px 12px -3px, rgba(0, 0, 0, 0.04) 0px 3px 6px -1px, rgba(0, 0, 0, 0.04) 0px 1px 2px 0px, rgba(0, 0, 0, 0.06) 0px 0.5px 0.5px 0px` | Popovers, dropdowns |
| Level 4 | `color(display-p3 0 0 0 / 0.019608) 0px 40px 48px -20px, color(display-p3 0 0 0 / 0.031373) 0px 32px 32px -20px, color(display-p3 0 0 0 / 0.031373) 0px 16px 24px -12px, color(display-p3 0 0 0 / 0.031373) 0px 0px 0px 1px` | Popovers, dropdowns |

> [!NOTE]
> **AI Analysis Required**: Describe if the site uses physical shadows or relies purely on flat color contrast.

## 7. Do's and Don'ts

> [!NOTE]
> **AI Analysis Required**: Extract 3-5 rigid constraints (e.g., "Do use all-caps for labels", "Don't use gradients").

## 8. Responsive Behavior

> [!NOTE]
> **AI Analysis Required**: Describe the collapsing strategy across breakpoints and touch target sizing.

## 9. Agent Prompt Guide

### Reference Tokens
- **Primary CTA**: `#0071e3`
- **Canvas**: `color(display-p3 0.929412 0.929412 0.929412)`
- **Text**: `color(display-p3 0.14902 0.14902 0.14902)`

> [!NOTE]
> **AI Analysis Required**: Write 3 specific example prompts that an LLM can use to generate UI components using this system.

```json
{
  "accentColor": "#0071e3",
  "fonts": [
    {
      "element": "a",
      "family": "suisse",
      "lineHeight": "24px",
      "size": "16px",
      "weight": "400"
    },
    {
      "element": "p",
      "family": "suisse",
      "lineHeight": "20px",
      "size": "14px",
      "weight": "400"
    }
  ],
  "primaryBg": "color(display-p3 0.929412 0.929412 0.929412)",
  "primaryText": "color(display-p3 0.14902 0.14902 0.14902)",
  "radiuses": [
    "12px",
    "10px",
    "8px",
    "20px",
    "999px",
    "16px"
  ],
  "shadows": [
    "color(display-p3 0.9804 0.1127 0.098 / 0.2) 0px -6px 12px 0px inset, color(display-p3 0.9804 0.3647 0.098 / 0.12) 0px 2px 4px 0px, color(display-p3 0.9804 0.3647 0.098 / 0.12) 0px 1px 1px 0px, color(display-p3 0.9804 0.3647 0.098 / 0.16) 0px 0.5px 0.5px 0px, color(display-p3 0.9804 0.3647 0.098 / 0.2) 0px 0.25px 0.25px 0px",
    "rgba(0, 0, 0, 0.02) 0px 6px 12px 0px inset, rgba(0, 0, 0, 0.02) 0px 0.75px 0.75px 0px inset, rgba(0, 0, 0, 0.04) 0px 0.25px 0.25px 0px inset",
    "rgba(0, 0, 0, 0.04) 0px 6px 12px -3px, rgba(0, 0, 0, 0.04) 0px 3px 6px -1px, rgba(0, 0, 0, 0.04) 0px 1px 2px 0px, rgba(0, 0, 0, 0.06) 0px 0.5px 0.5px 0px",
    "color(display-p3 0 0 0 / 0.019608) 0px 40px 48px -20px, color(display-p3 0 0 0 / 0.031373) 0px 32px 32px -20px, color(display-p3 0 0 0 / 0.031373) 0px 16px 24px -12px, color(display-p3 0 0 0 / 0.031373) 0px 0px 0px 1px",
    "rgba(0, 0, 0, 0.12) 0px 2px 12px 0px, rgba(0, 0, 0, 0.56) 0px 0px 1px 0px"
  ],
  "topBg": [
    "color(display-p3 0.929412 0.929412 0.929412)",
    "color(display-p3 0 0 0 / 0.039216)",
    "color(display-p3 0.976471 0.976471 0.976471)",
    "color(display-p3 0.9816 0.3634 0.0984)",
    "color(display-p3 1 1 1)",
    "color(display-p3 0 0 0 / 0.121569)"
  ],
  "topText": [
    "color(display-p3 0.14902 0.14902 0.14902)",
    "color(display-p3 1 1 1)",
    "color(display-p3 0.14902 0.14902 0.14902 / 0.560784)",
    "color(display-p3 0.14902 0.14902 0.14902 / 0.4)",
    "color(display-p3 0.14902 0.14902 0.14902 / 0.478431)",
    "#000000"
  ]
}
```
