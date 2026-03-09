# Design System Specification — Gemini 3.1 Pro Review

As a product designer who obsesses over developer tools, I love the direction of "Boring UI." The name implies a tool that gets out of the way and lets the user focus on the work. 

However, your current design tokens are a bit too "out-of-the-box Tailwind." To reach the tier of Linear, Vercel, or Raycast, we need to move from *generic* to *purpose-built*. Dev tools require high information density, extremely subtle hierarchy, and zero eye strain over 8-hour sessions.

Here is your world-class design specification and audit.

---

### 1. Color Palette Audit & Recommendations

**The Orange Problem:** `#ea580c` is a fantastic marketing color, but a terrible primary UI accent for an IDE. It induces urgency and visual fatigue. 
*   **Linear** uses a highly desaturated indigo.
*   **Vercel** uses black/white for primary actions and reserves colors only for state (success/error).
*   **Cursor** uses subtle, low-saturation blues.
*   *Recommendation:* Shift to a monochrome-first UI (black/white/gray buttons) and use a sleek **Cobalt/Indigo** for focus rings and active states. Keep the orange *strictly* for the AI Agent (to give it a distinct "personality" separate from the IDE).

**The Dark Mode Problem:** `#0f0f0f` is too dark. It creates too much contrast with white text, causing astigmatism halation (fuzzy text). 
*   **VS Code / Cursor:** `~#181818` to `#1e1e1e`
*   **Linear:** `#191919`
*   *Recommendation:* Elevate your dark mode floor to `#111111` or `#161618`. This allows you to use *darker* colors (`#000000`) for inset elements like the terminal or code editor to create depth, rather than relying on lighter colors which wash out the UI.

**The Grays:** Your grays are neutral. Dev tools feel more premium with slightly tinted grays. I recommend a "Zinc" (slightly cool) or "Mauve" (slightly purple, like Radix UI) scale for dark mode to make it feel rich.

### 2. Typography System

**Font Choice:** `Inter` is great, but it's wide. Vercel built `Geist` specifically to solve this. If you stick with Inter, you **must** apply custom letter-spacing to make it look premium.
*   **Code Font:** `JetBrains Mono` is perfect. Keep it.
*   **The Missing Size:** Your scale misses the most important size in desktop app design: **13px**. Linear, Slack, and VS Code use 13px heavily. 14px is too big for file trees; 12px is too small for readability.

**Premium Type Scale:**
*   `--text-micro: 0.6875rem; /* 11px - Badges, tiny metadata */`
*   `--text-xs: 0.75rem;      /* 12px - File tree, secondary text */`
*   `--text-sm: 0.8125rem;    /* 13px - Base UI, buttons, inputs (THE SWEET SPOT) */`
*   `--text-base: 0.875rem;   /* 14px - Settings text, chat bubbles */`
*   `--text-lg: 1rem;         /* 16px - H3, Editor base font */`

**Line Heights & Tracking:**
*   UI text needs tight line height: `1.2` to `1.4`. 
*   Apply `letter-spacing: -0.01em` to Inter at 13px/14px, and `-0.02em` for headers. It instantly looks 10x more professional.

### 3. Spacing & Sizing

Your 4px grid is correct, but your application of it needs to be denser. IDEs are about information density.
*   **Base UI Height:** Inputs and buttons should be `28px` (small) or `32px` (default). Tailwind's default 40px is for marketing sites, not IDEs.
*   **Paddings:** 
    *   Buttons: `4px 12px`
    *   File tree rows: `4px 8px`
    *   Panel gaps: `1px` (using a background color on the wrapper and grid gap to create 1px borders, rather than actual CSS borders).

### 4. Shadows & Depth

Drop generic shadows. Premium tools use multi-layered composite shadows. In dark mode, **shadows do not work**. Instead, you use "inner borders" (inset shadows) to create the illusion of light hitting the top edge of a component.

### 5. Border Radius

IDEs need to feel sharp and precise. `24px` and `16px` are too bubbly.
*   `--radius-xs: 2px; /* Checkboxes, tiny tags */`
*   `--radius-sm: 4px; /* File tabs, small buttons */`
*   `--radius-md: 6px; /* Base buttons, inputs, dropdown menus (The Linear standard) */`
*   `--radius-lg: 8px; /* Floating panels, dialogs */`
*   `--radius-xl: 12px; /* Large modals only */`

---

### 6. The Exact CSS Specification

Replace your current tokens with these. They are mathematically calculated for perfect contrast, depth, and a premium "Vercel/Linear" feel.

```css
:root {
  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  
  --text-micro: 0.6875rem; /* 11px */
  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.8125rem;    /* 13px - Main UI */
  --text-base: 0.875rem;   /* 14px */
  --text-lg: 1rem;         /* 16px */
  --text-xl: 1.125rem;     /* 18px */
  
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;

  /* Premium Radii (Sharper) */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  /* LIGHT MODE PALETTE (Crisp, High-Contrast) */
  --color-bg-canvas: #f4f4f5;    /* App background behind panels */
  --color-bg-primary: #ffffff;   /* Main panels, editor */
  --color-bg-secondary: #fafafa; /* Sidebars */
  --color-bg-hover: #f4f4f5;
  --color-bg-active: #e4e4e7;
  --color-bg-inverse: #18181b;

  --color-text-primary: #09090b;
  --color-text-secondary: #52525b;
  --color-text-tertiary: #a1a1aa;
  --color-text-inverse: #ffffff;

  /* Borders: Light mode uses solid colors */
  --color-border: #e4e4e7;
  --color-border-strong: #d4d4d8;

  /* Accents: Shifted from Orange to a Professional Indigo/Blue */
  --color-accent: #0070f3; /* Vercel Blue */
  --color-accent-hover: #0060d3;
  --color-accent-bg: rgba(0, 112, 243, 0.1);
  
  /* Retain Orange strictly for AI/Agent features */
  --color-ai-agent: #ea580c; 
  --color-ai-agent-glow: rgba(234, 88, 12, 0.15);

  /* Composite Shadows (Light Mode) */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --shadow-float: 0 0 0 1px rgba(0,0,0,0.05), 0 8px 24px -4px rgba(0,0,0,0.1); /* For command palettes */
  
  /* Focus Rings (Mac/Linear style) */
  --ring-focus: 0 0 0 2px #ffffff, 0 0 0 4px rgba(0, 112, 243, 0.4);

  /* Animation Curves (Snappy, Apple-like) */
  --ease-out-flex: cubic-bezier(0.16, 1, 0.3, 1);
  --transition-fast: 100ms var(--ease-out-flex);
  --transition-normal: 200ms var(--ease-out-flex);
}

[data-theme="dark"] {
  /* DARK MODE PALETTE (Deep, low eye-strain) */
  --color-bg-canvas: #000000;    /* The deepest layer (e.g., terminal or window bg) */
  --color-bg-primary: #111111;   /* Main editor */
  --color-bg-secondary: #18181b; /* Sidebars, AI panel */
  --color-bg-hover: rgba(255, 255, 255, 0.06);
  --color-bg-active: rgba(255, 255, 255, 0.1);
  --color-bg-inverse: #ffffff;

  --color-text-primary: #ededed;
  --color-text-secondary: #a1a1aa;
  --color-text-tertiary: #71717a;
  --color-text-inverse: #000000;

  /* The Dark Mode Secret: Alpha Borders. 
     Never use solid grays for borders in dark mode. 
     Alpha white blends perfectly with any background depth. */
  --color-border: rgba(255, 255, 255, 0.1);
  --color-border-strong: rgba(255, 255, 255, 0.15);

  --color-accent: #3b82f6; 
  --color-accent-hover: #60a5fa;
  --color-accent-bg: rgba(59, 130, 246, 0.15);

  --color-ai-agent: #f97316; /* Slightly brighter orange for dark mode contrast */

  /* Shadows in Dark Mode: Drop shadows don't work. We use inset lighting. */
  --shadow-sm: inset 0 1px 0 0 rgba(255, 255, 255, 0.05); /* Button top highlight */
  --shadow-md: 0 0 0 1px rgba(255,255,255,0.1), 0 8px 16px rgba(0,0,0,0.5); /* Dropdowns */
  --shadow-float: 0 0 0 1px rgba(255,255,255,0.1), 0 16px 32px rgba(0,0,0,0.8), inset 0 1px 0 0 rgba(255,255,255,0.05); 
  
  --ring-focus: 0 0 0 2px #111111, 0 0 0 4px rgba(59, 130, 246, 0.6);
}

/* Base application styling */
body {
  font-family: var(--font-sans);
  font-size: var(--text-sm); /* Default to 13px */
  letter-spacing: -0.01em;   /* Crucial for Inter to look premium */
  line-height: 1.4;
  color: var(--color-text-primary);
  background-color: var(--color-bg-canvas);
  -webkit-font-smoothing: antialiased;
}
```

### Implementation Rules for "Boring UI"

1. **The 1px Panel Gap Trick:** Instead of putting `border-right` on your sidebar, make the main container `background: var(--color-border); display: flex; gap: 1px;`. Then give your sidebar and editor `background: var(--color-bg-primary)`. This creates flawless, un-overlapping 1px hairlines everywhere.
2. **Buttons:** Primary buttons should be `background: var(--color-bg-inverse); color: var(--color-text-inverse)`. Only use your Blue accent for primary actions if it's a destructive/highly specific state. Normal actions should be monochrome.
3. **AI Agent Chat:** Give the AI agent panel a subtle radial gradient background `radial-gradient(circle at top right, var(--color-ai-agent-glow), transparent 40%)` to conceptually separate it from the "boring" file trees and code editors.
4. **Interactive Elements:** Every clickable element needs a hover state (`--color-bg-hover`) and an active state (`--color-bg-active`). The active state (when the mouse is clicked down) makes the app feel tactile and native.
