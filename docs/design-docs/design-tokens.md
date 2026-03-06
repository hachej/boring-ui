# Design Token Specification

Target: Linear / Vercel / Raycast tier polish.
Source: Gemini 2.5 Flash comprehensive review (2026-03-06), refined for implementation.
Reviewed by: Gemini 3.1 Pro Preview (2026-03-06) — fixes applied below.

Referenced by: `bd-ui01` epic, tracks 1-22 in `.beads/issues.jsonl`
Review: `.boring/gemini-review-beads-and-tokens-v1.md`

---

## Color Tokens

### Base Colors (Neutral Palette)

| Token                          | Light        | Dark         | Usage                                    |
| :----------------------------- | :----------- | :----------- | :--------------------------------------- |
| `--color-background-primary`   | `#FFFFFF`    | `#1F1F1F`    | Main app background                      |
| `--color-background-secondary` | `#F8F8F8`    | `#242424`    | Sidebar, panels, card backgrounds        |
| `--color-background-tertiary`  | `#F0F0F0`    | `#2C2C2C`    | Hover states, selected items, deeper UI  |
| `--color-background-elevated`  | `#FFFFFF`    | `#333333`    | Menus, tooltips, modals (with shadow)    |
| `--color-text-primary`         | `#1A1A1A`    | `#E0E0E0`    | Main body text, headings                 |
| `--color-text-secondary`       | `#6B6B6B`    | `#A8A8A8`    | Helper text, subtle labels, metadata     |
| `--color-text-tertiary`        | `#767676`    | `#888888`    | Placeholders, disabled text (WCAG AA)    |
| `--color-text-link`            | `#007AFF`    | `#61DAFB`    | Interactive links                        |
| `--color-border-primary`       | `#E0E0E0`    | `#404040`    | Main panel dividers, input borders       |
| `--color-border-secondary`     | `#F0F0F0`    | `#303030`    | Subtle internal borders, inactive tabs   |
| `--color-icon-primary`         | `#4A4A4A`    | `#B0B0B0`    | Default icon color                       |
| `--color-icon-secondary`       | `#808080`    | `#707070`    | Subtle icons, disabled icons             |

### Semantic Colors (Accent / Status)

| Token                      | Light        | Dark         | Usage                              |
| :------------------------- | :----------- | :----------- | :--------------------------------- |
| `--color-accent-default`   | `#007AFF`    | `#61DAFB`    | Primary interactive (buttons, links) |
| `--color-accent-hover`     | `#005BCC`    | `#3D9DD6`    | Accent hover state                 |
| `--color-accent-active`    | `#0040A0`    | `#2A7399`    | Accent active/pressed state        |
| `--color-success`          | `#28A745`    | `#2ECC71`    | Success messages, clean state      |
| `--color-warning`          | `#FFC107`    | `#F1C40F`    | Warning messages                   |
| `--color-error`            | `#DC3545`    | `#E74C3C`    | Error messages, critical status    |
| `--color-info`             | `#17A2B8`    | `#3498DB`    | Informational messages             |
| `--color-success-bg`       | `rgba(40,167,69,0.1)` | `rgba(46,204,113,0.12)` | Success alert/banner bg    |
| `--color-warning-bg`       | `rgba(255,193,7,0.1)`  | `rgba(241,196,15,0.12)`  | Warning alert/banner bg    |
| `--color-error-bg`         | `rgba(220,53,69,0.1)` | `rgba(231,76,60,0.12)` | Error alert/banner bg        |
| `--color-info-bg`          | `rgba(23,162,184,0.1)` | `rgba(52,152,219,0.12)` | Info alert/banner bg        |
| `--color-text-on-accent`   | `#FFFFFF`    | `#FFFFFF`    | Text on accent backgrounds         |
| `--color-focus-ring`       | `#007AFF`    | `#61DAFB`    | Focus ring color (= accent)       |

### Domain-Specific Colors

| Token                      | Light        | Dark         | Usage                              |
| :------------------------- | :----------- | :----------- | :--------------------------------- |
| `--color-chat-user-bg`     | `#F0F0F0`    | `#2C2C2C`    | User's chat messages               |
| `--color-chat-agent-bg`    | `#FFFFFF`    | `#242424`    | Agent's chat messages              |
| `--color-chat-tool-bg`     | `#E8E8E8`    | `#333333`    | Tool call blocks                   |
| `--color-code-bg`          | `#F5F5F5`    | `#282C34`    | Code blocks                        |
| `--color-diff-added`       | `#E6FFED`    | `#1F4A2F`    | Diff added lines                   |
| `--color-diff-removed`     | `#FFEBEB`    | `#4A2F2F`    | Diff removed lines                 |

---

## Typography Scale

**Font family:** `Inter`, `SF Pro Text`, or `system-ui` (Linear uses Inter).
**Monospace:** `JetBrains Mono`, `Fira Code`, or `ui-monospace`.

| Token                    | Size   | Weight | Line Height | Letter Spacing | Usage                          |
| :----------------------- | :----- | :----- | :---------- | :------------- | :----------------------------- |
| `--font-size-xs`         | `11px` | `400`  | `1.4`       | `0.02em`       | Cost metrics, very subtle labels |
| `--font-size-sm`         | `12px` | `400`  | `1.4`       | `0.01em`       | Captions, helper text, status  |
| `--font-size-ui`         | `13px` | `400`  | `1.4`       | `0em`          | Sidebar, file tree, tooling UI |
| `--font-size-base`       | `14px` | `400`  | `1.5`       | `0em`          | Body text, menu items, chat    |
| `--font-size-md`         | `16px` | `500`  | `1.4`       | `0em`          | Subheadings, prominent labels  |
| `--font-size-lg`         | `18px` | `600`  | `1.3`       | `-0.01em`      | Section titles, headers        |
| `--font-size-xl`         | `20px` | `700`  | `1.2`       | `-0.01em`      | Major titles                   |

| Token                      | Value |
| :------------------------- | :---- |
| `--font-weight-regular`    | `400` |
| `--font-weight-medium`     | `500` |
| `--font-weight-semibold`   | `600` |
| `--font-weight-bold`       | `700` |

---

## Spacing Scale

8px grid for major elements, 4px for fine adjustments.

| Token            | Value  | Usage                              |
| :--------------- | :----- | :--------------------------------- |
| `--spacing-xxs`  | `2px`  | Tiny gaps, icon padding            |
| `--spacing-xs`   | `4px`  | Small padding, icon-text spacing   |
| `--spacing-1`    | `6px`  | Compact component internal padding |
| `--spacing-sm`   | `8px`  | Default padding, list item spacing |
| `--spacing-1.5`  | `10px` | Dense component padding            |
| `--spacing-md`   | `12px` | Medium padding, button padding     |
| `--spacing-lg`   | `16px` | Section padding, component gaps    |
| `--spacing-xl`   | `20px` | Major section separation           |
| `--spacing-xxl`  | `24px` | Panel gutters, content blocks      |
| `--spacing-3xl`  | `32px` | Extra large spacing                |

---

## Shadow System

Minimalist, subtle. Dark mode uses inner border glows instead of heavy drop shadows.

**Light mode:**

| Token            | Value                                                              | Usage                        |
| :--------------- | :----------------------------------------------------------------- | :--------------------------- |
| `--shadow-sm`    | `0 1px 2px rgba(0, 0, 0, 0.05)`                                   | Input focus, button hover    |
| `--shadow-md`    | `0 2px 4px rgba(0, 0, 0, 0.08)`                                   | Cards, small dropdowns       |
| `--shadow-lg`    | `0 4px 8px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.06)`   | Menus, tooltips, modals      |
| `--shadow-inset` | `inset 0 1px 2px rgba(0, 0, 0, 0.06)`                             | Recessed elements, active    |

**Dark mode** (inner border glows, not heavy drop shadows):

| Token            | Value                                                              | Usage                        |
| :--------------- | :----------------------------------------------------------------- | :--------------------------- |
| `--shadow-sm`    | `inset 0 0 0 1px rgba(255, 255, 255, 0.06)`                       | Subtle elevation             |
| `--shadow-md`    | `inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 2px 4px rgba(0, 0, 0, 0.2)` | Cards, dropdowns |
| `--shadow-lg`    | `inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 4px 8px rgba(0, 0, 0, 0.3)` | Menus, tooltips, modals |
| `--shadow-inset` | `inset 0 1px 2px rgba(0, 0, 0, 0.2)`                              | Recessed elements            |

---

## Border Radius

| Token           | Value    | Usage                           |
| :-------------- | :------- | :------------------------------ |
| `--radius-none` | `0px`    | Sharp corners                   |
| `--radius-sm`   | `2px`    | Subtle rounding                 |
| `--radius-md`   | `4px`    | Default (buttons, inputs)       |
| `--radius-lg`   | `6px`    | Cards, menus                    |
| `--radius-full` | `9999px` | Pills, circles                  |

---

## Z-Index Scale

| Token              | Value  | Usage                         |
| :----------------- | :----- | :---------------------------- |
| `--z-below`        | `-1`   | Background layers             |
| `--z-base`         | `0`    | Default stacking              |
| `--z-sticky`       | `10`   | Sticky headers, toolbars      |
| `--z-dropdown`     | `100`  | Dropdowns, menus              |
| `--z-overlay`      | `200`  | Overlays, side panels         |
| `--z-modal`        | `300`  | Modal dialogs                 |
| `--z-tooltip`      | `400`  | Tooltips (always on top)      |
| `--z-toast`        | `500`  | Toast notifications           |

---

## Animation / Easing Tokens

| Token                | Value                              | Usage                         |
| :------------------- | :--------------------------------- | :---------------------------- |
| `--ease-out-fluid`   | `cubic-bezier(0.3, 0, 0, 1)`      | Sidebar, panel transitions    |
| `--ease-in-out`      | `cubic-bezier(0.4, 0, 0.2, 1)`    | General transitions           |
| `--ease-spring`      | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bounce/spring animations    |
| `--duration-fast`    | `100ms`                            | Hover, focus ring             |
| `--duration-default` | `150ms`                            | Menu open, tab switch         |
| `--duration-smooth`  | `200ms`                            | Sidebar collapse, panel       |
| `--duration-slow`    | `300ms`                            | Modal, page transitions       |

---

## Component Specs

### Buttons

| Property     | Small    | Default  | Large    |
| :----------- | :------- | :------- | :------- |
| Height       | `32px`   | `36px`   | `40px`   |
| Padding      | `0 12px` | `0 12px` | `0 16px` |
| Radius       | `4px`    | `4px`    | `4px`    |

- **Primary:** bg `--color-accent-default`, text `white`
- **Secondary/Ghost:** bg `--color-background-tertiary`, text `--color-text-primary`
- **Hover:** bg `--color-accent-hover`, shadow `--shadow-sm`
- **Active:** bg `--color-accent-active`, shadow `--shadow-inset`
- **Focus:** `outline: 2px solid var(--color-accent-default)`

### Inputs

- **Height:** `36px`
- **Padding:** `0 8px`
- **Border:** `1px solid var(--color-border-primary)`
- **Radius:** `--radius-md`
- **Background:** `var(--color-background-elevated)`
- **Placeholder:** `var(--color-text-tertiary)`
- **Focus:** `border-color: var(--color-accent-default)`, `box-shadow: 0 0 0 1px var(--color-accent-default)`

### Tooltips

- **Background:** `var(--color-background-elevated)`
- **Text:** `var(--color-text-primary)`
- **Padding:** `4px 8px`
- **Radius:** `--radius-md`
- **Font size:** `--font-size-sm` (12px)
- **Shadow:** `--shadow-lg`

### Menus / Dropdowns

- **Background:** `var(--color-background-elevated)`
- **Border:** `1px solid var(--color-border-primary)`
- **Radius:** `--radius-lg` (6px)
- **Padding:** `4px 0`
- **Shadow:** `--shadow-lg`
- **Item height:** `32px`
- **Item padding:** `0 12px`
- **Item hover:** `background: var(--color-background-tertiary)`
- **Item active:** `background: var(--color-accent-default)`, `color: white`
- **Item icon:** `var(--color-icon-secondary)`

### Tabs

- **Height:** `36px`
- **Padding:** `0 12px`
- **Inactive bg:** `var(--color-background-secondary)`
- **Active bg:** `var(--color-background-primary)`
- **Active indicator:** `2px solid var(--color-accent-default)` bottom border
- **Inactive text:** `var(--color-text-secondary)`
- **Active text:** `var(--color-text-primary)`
- **Close icon:** `var(--color-icon-secondary)`, hover: `var(--color-icon-primary)`

### Toolbar (Editor)

- **Height:** `36px`
- **Background:** `var(--color-background-secondary)`
- **Border bottom:** `1px solid var(--color-border-primary)`
- **Icon padding:** `4px`
- **Icon gap:** `4px`
- **Icon color:** `var(--color-icon-primary)`, hover: `var(--color-accent-default)`
- **Active button:** `background: var(--color-background-tertiary)`, `border-radius: --radius-sm`

---

## Iconography Rules

- **Library:** Lucide React (single source)
- **Inline:** 16px
- **Toolbar:** 18px
- **Activity bar:** 20px
- **Stroke width:** 1.5px
- **Default color:** `var(--color-icon-primary)`
- **Muted:** `var(--color-icon-secondary)`
- **Hover:** `var(--color-accent-default)`

---

## Interactive States (Global)

All clickable elements must implement:

| State          | Treatment                                                       |
| :------------- | :-------------------------------------------------------------- |
| **Hover**      | `background: var(--color-background-tertiary)`, `transition: 0.15s ease` |
| **Active**     | `background: var(--color-accent-active)` or `transform: scale(0.98)` |
| **Focus**      | `outline: 2px solid var(--color-accent-default)`, `offset: 2px` |
| **Focus-visible** | Show focus ring only on keyboard navigation                  |
| **Disabled**   | `opacity: 0.5`, `cursor: not-allowed`                          |
