import type { ReactNode } from "react"
import type { TooltipProps } from "recharts"
import { cn } from "../lib/utils"

export interface BoringChartTheme {
  background: string
  foreground: string
  mutedForeground: string
  border: string
  grid: string
  tooltipBackground: string
  tooltipBorder: string
  tooltipForeground: string
  palette: string[]
}

export const boringChartPalette = [
  "var(--chart-1, var(--accent))",
  "var(--chart-2, #60a5fa)",
  "var(--chart-3, #34d399)",
  "var(--chart-4, #f59e0b)",
  "var(--chart-5, #f472b6)",
  "var(--chart-6, #a78bfa)",
  "var(--chart-7, #22d3ee)",
  "var(--chart-8, #fb7185)",
]

export const boringChartTheme: BoringChartTheme = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  mutedForeground: "var(--muted-foreground)",
  border: "var(--border)",
  grid: "oklch(from var(--border) l c h / 0.48)",
  tooltipBackground: "var(--popover, var(--background))",
  tooltipBorder: "var(--border)",
  tooltipForeground: "var(--popover-foreground, var(--foreground))",
  palette: boringChartPalette,
}

export function getBoringChartColor(index: number, theme: BoringChartTheme = boringChartTheme): string {
  if (theme.palette.length === 0) return "var(--accent)"
  const normalizedIndex = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0
  return theme.palette[normalizedIndex % theme.palette.length] ?? theme.palette[0] ?? "var(--accent)"
}

export function defaultBoringChartValueFormatter(value: unknown): string {
  if (typeof value === "number") {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  }
  return value == null ? "—" : String(value)
}

export type BoringChartValueFormatter = (value: unknown) => string

export function BoringTooltip({
  active,
  payload,
  label,
  valueFormatter = defaultBoringChartValueFormatter,
}: TooltipProps<number | string, string> & { valueFormatter?: BoringChartValueFormatter }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div
      className="min-w-32 rounded-md border px-2.5 py-2 text-xs shadow-xl"
      style={{
        background: boringChartTheme.tooltipBackground,
        borderColor: boringChartTheme.tooltipBorder,
        color: boringChartTheme.tooltipForeground,
      }}
    >
      {label != null && (
        <div className="mb-1.5 font-medium" style={{ color: boringChartTheme.foreground }}>
          {String(label)}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((item, index) => (
          <div key={`${item.dataKey ?? item.name ?? "series"}:${index}`} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5" style={{ color: boringChartTheme.mutedForeground }}>
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: item.color }}
              />
              {item.name ?? item.dataKey}
            </span>
            <span className="font-mono tabular-nums" style={{ color: boringChartTheme.foreground }}>
              {valueFormatter(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface BoringChartFrameProps {
  title?: string
  subtitle?: string
  source?: string
  height?: number | string
  className?: string
  children: ReactNode
}

export function BoringChartFrame({
  title,
  subtitle,
  source,
  height = 320,
  className,
  children,
}: BoringChartFrameProps) {
  return (
    <figure
      className={cn(
        "flex min-h-0 w-full flex-col rounded-xl border bg-card/60 text-card-foreground",
        "shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_12px_32px_-22px_oklch(0_0_0/0.28)]",
        className,
      )}
      style={{ borderColor: boringChartTheme.border }}
    >
      {(title || subtitle) && (
        <figcaption className="border-b px-3 py-2" style={{ borderColor: boringChartTheme.border }}>
          {title && <div className="text-sm font-semibold tracking-[-0.01em]">{title}</div>}
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </figcaption>
      )}
      <div className="min-h-0 flex-1 p-3" style={{ height }}>
        {children}
      </div>
      {source && (
        <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground" style={{ borderColor: boringChartTheme.border }}>
          {source}
        </div>
      )}
    </figure>
  )
}

export const boringCartesianAxisProps = {
  tick: { fill: boringChartTheme.mutedForeground, fontSize: 11 },
  axisLine: { stroke: boringChartTheme.border },
  tickLine: { stroke: boringChartTheme.border },
} as const

export const boringCartesianGridProps = {
  stroke: boringChartTheme.grid,
  strokeDasharray: "3 3",
  vertical: false,
} as const

export const boringLegendProps = {
  wrapperStyle: { color: boringChartTheme.mutedForeground, fontSize: 12 },
} as const

export const boringLineProps = {
  type: "monotone",
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4 },
  connectNulls: true,
  isAnimationActive: false,
} as const

export const boringAreaProps = {
  type: "monotone",
  strokeWidth: 2,
  dot: false,
  connectNulls: true,
  isAnimationActive: false,
} as const

export const boringBarProps = {
  radius: [6, 6, 2, 2] as [number, number, number, number],
  isAnimationActive: false,
} as const

export const boringPieProps = {
  innerRadius: "58%",
  outerRadius: "82%",
  paddingAngle: 2,
  isAnimationActive: false,
} as const

export const boringReferenceAreaProps = {
  fill: "oklch(from var(--accent) l c h / 0.20)",
} as const
