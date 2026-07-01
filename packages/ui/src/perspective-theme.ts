export interface BoringPerspectiveThemeOptions {
  /** Hide Perspective/d3fc axis titles when surrounding UI already labels the chart. */
  hideAxisLabels?: boolean
  /** Use app sans font for d3fc axis/tick labels instead of Perspective's mono token. */
  chartTicksUseSans?: boolean
}

export function boringPerspectiveThemeName(root: Pick<Element, "classList"> | null | undefined = globalThis.document?.documentElement): "Pro Light" | "Pro Dark" {
  return root?.classList.contains("dark") ? "Pro Dark" : "Pro Light"
}

function resolveCssColor(value: string, fallback: string): string {
  if (typeof document === "undefined") return fallback
  const probe = document.createElement("span")
  probe.style.color = value
  probe.style.position = "fixed"
  probe.style.pointerEvents = "none"
  probe.style.opacity = "0"
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color || fallback
  probe.remove()
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return computed || fallback
  context.fillStyle = computed
  const normalized = context.fillStyle || computed || fallback
  return /^oklch\(/i.test(normalized) || /^var\(/i.test(normalized) ? fallback : normalized
}

export function applyBoringPerspectiveTheme(element: HTMLElement, options: BoringPerspectiveThemeOptions = {}): void {
  const primaryColor = resolveCssColor("var(--boring-primary, var(--primary))", "#2f2d2a")
  const fontSans = "var(--boring-font-sans, var(--font-sans, ui-sans-serif, system-ui, sans-serif))"
  element.style.background = "var(--boring-card, var(--card))"
  element.style.color = "var(--boring-card-foreground, var(--card-foreground))"
  element.style.fontFamily = fontSans
  element.style.setProperty("--psp--background-color", "var(--boring-card, var(--card))")
  element.style.setProperty("--psp--color", "var(--boring-foreground, var(--foreground))")
  element.style.setProperty("--psp-active--color", "var(--boring-primary, var(--primary))")
  element.style.setProperty("--psp-inactive--color", "var(--boring-muted-foreground, var(--muted-foreground))")
  element.style.setProperty("--psp-inactive--border-color", "var(--boring-border, var(--border))")
  element.style.setProperty("--psp-font-family", fontSans)
  element.style.setProperty(
    "--psp-interface-monospace--font-family",
    options.chartTicksUseSans === false
      ? "var(--boring-font-mono, var(--font-mono, ui-monospace, monospace))"
      : fontSans,
  )
  element.style.setProperty("--psp-datagrid--row--height", "28px")

  element.style.setProperty("--psp-d3fc--axis-ticks--color", "var(--boring-muted-foreground, var(--muted-foreground))")
  element.style.setProperty("--psp-d3fc--axis-lines--color", "var(--boring-border, var(--border))")
  // d3fc/chroma parses concrete colors, not CSS variables/relative colors.
  element.style.setProperty("--psp-d3fc--series--color", primaryColor)
  for (let index = 1; index <= 12; index += 1) {
    element.style.setProperty(`--psp-d3fc--series--color-${index}`, primaryColor)
  }
  element.style.setProperty("--psp-d3fc--legend--color", "var(--boring-foreground, var(--foreground))")
  element.style.setProperty("--psp-d3fc--legend--background", "var(--boring-card, var(--card))")
  element.style.setProperty("--psp-d3fc--tooltip--background", "var(--boring-popover, var(--popover))")
  element.style.setProperty("--psp-d3fc--tooltip--color", "var(--boring-popover-foreground, var(--popover-foreground))")
  element.style.setProperty("--psp-d3fc--tooltip--border-color", "var(--boring-border, var(--border))")

  element.style.setProperty("--psp-datagrid--pos-cell--color", "var(--boring-success, var(--success))")
  element.style.setProperty("--psp-datagrid--neg-cell--color", "var(--boring-destructive, var(--destructive))")

  if (options.hideAxisLabels !== false) {
    element.style.setProperty("--psp-d3fc--label--color", "transparent")
  }
}
