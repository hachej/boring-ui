# Design System: Color Palette Overhaul

**Priority:** CRITICAL (foundation — all other beads depend on correct tokens)
**Component:** `src/front/styles.css` `:root` + `[data-theme="dark"]`
**Source:** DESIGN-SYSTEM-SPEC.md

## Problem
- Current palette is stock Tailwind grays (neutral, generic)
- Orange accent (#ea580c) used for everything — causes visual fatigue in an IDE
- Dark mode too dark (#0f0f0f) — causes halation with white text
- Dark mode borders use solid grays — look harsh at different depths

## Changes

### Light mode
```css
:root {
  /* Backgrounds: shift to Zinc scale (slightly cool) */
  --color-bg-canvas: #f4f4f5;     /* NEW: app background behind panels */
  --color-bg-primary: #ffffff;     /* unchanged */
  --color-bg-secondary: #fafafa;   /* was #f9fafb */
  --color-bg-tertiary: #f4f4f5;   /* was #f3f4f6 */
  --color-bg-hover: #f4f4f5;      /* was #f3f4f6 */
  --color-bg-active: #e4e4e7;     /* was #e5e7eb */
  --color-bg-inverse: #18181b;    /* NEW: for monochrome primary buttons */

  /* Text: slightly deeper black, Zinc secondaries */
  --color-text-primary: #09090b;   /* was #111827 */
  --color-text-secondary: #52525b; /* was #6b7280 */
  --color-text-tertiary: #a1a1aa;  /* was #9ca3af */
  --color-text-inverse: #ffffff;   /* unchanged */

  /* Borders: Zinc scale */
  --color-border: #e4e4e7;        /* was #e5e7eb */
  --color-border-strong: #d4d4d8; /* was #d1d5db */

  /* Accent: split into IDE accent (blue) + AI accent (orange) */
  --color-accent: #0070f3;        /* was #ea580c — now Vercel blue */
  --color-accent-hover: #0060d3;  /* was #c2410c */
  --color-accent-light: rgba(0, 112, 243, 0.1); /* was #fff7ed */

  /* NEW: AI Agent accent (orange reserved for agent personality) */
  --color-ai-agent: #ea580c;
  --color-ai-agent-hover: #c2410c;
  --color-ai-agent-glow: rgba(234, 88, 12, 0.15);
}
```

### Dark mode
```css
[data-theme="dark"] {
  /* Backgrounds: raise floor from #0f0f0f to #111111 */
  --color-bg-canvas: #000000;     /* NEW: deepest layer (terminal bg) */
  --color-bg-primary: #111111;    /* was #0f0f0f */
  --color-bg-secondary: #18181b;  /* was #1a1a1a */
  --color-bg-tertiary: #27272a;   /* was #262626, now Zinc-800 */
  --color-bg-hover: rgba(255, 255, 255, 0.06);   /* was #333333 */
  --color-bg-active: rgba(255, 255, 255, 0.1);   /* was #404040 */
  --color-bg-inverse: #ffffff;    /* NEW */

  /* Text: slightly softer white */
  --color-text-primary: #ededed;   /* was #f9fafb */
  --color-text-secondary: #a1a1aa; /* was #9ca3af */
  --color-text-tertiary: #71717a;  /* was #6b7280 */

  /* CRITICAL: Alpha borders instead of solid grays */
  --color-border: rgba(255, 255, 255, 0.1);     /* was #333333 */
  --color-border-strong: rgba(255, 255, 255, 0.15); /* was #444444 */

  /* Accent: blue in dark mode too */
  --color-accent: #3b82f6;        /* was #ea580c */
  --color-accent-hover: #60a5fa;
  --color-accent-light: rgba(59, 130, 246, 0.15);

  /* AI Agent: slightly brighter orange for dark contrast */
  --color-ai-agent: #f97316;
  --color-ai-agent-glow: rgba(249, 115, 22, 0.15);
}
```

## Migration
Every usage of `--color-accent` for the AI agent (chat send button, agent panel glow) must switch to `--color-ai-agent`. The `--color-accent` is now blue and used for focus rings, active tabs, and general IDE interactions.

## Files to modify
- `src/front/styles.css` (token definitions + all accent usages)
- `src/front/providers/pi/nativeAdapter.jsx` (pi-web-ui CSS overrides: `--primary` maps to `--color-ai-agent`)
- `src/back/boring_ui/api/modules/control_plane/auth_router_supabase.py` (auth page accent)

## Acceptance criteria
- Light mode uses Zinc-tinted grays, not neutral Tailwind grays
- Accent is blue for IDE, orange for AI agent only
- Dark mode floor is #111111, not #0f0f0f
- Dark mode borders use alpha white, not solid grays
- No visual regressions in either theme
