import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  BoringChartFrame,
  BoringTooltip,
  boringBarProps,
  boringCartesianAxisProps,
  boringCartesianGridProps,
  boringChartTheme,
  boringLegendProps,
  boringLineProps,
  boringReferenceAreaProps,
  getBoringChartColor,
} from "../index"

describe("workspace charts", () => {
  it("uses boring design-system CSS variables for chart theme tokens", () => {
    expect(boringChartTheme.background).toBe("var(--background)")
    expect(boringChartTheme.foreground).toBe("var(--foreground)")
    expect(boringChartTheme.border).toBe("var(--border)")
    expect(getBoringChartColor(0)).toContain("var(--chart-1")
    expect(getBoringChartColor(9)).toBe(getBoringChartColor(1))
    expect(getBoringChartColor(-1)).toBe(getBoringChartColor(7))
    expect(getBoringChartColor(0, { ...boringChartTheme, palette: [] })).toBe("var(--accent)")
  })

  it("renders the standard chart frame chrome", () => {
    const html = renderToStaticMarkup(
      <BoringChartFrame title="Revenue" subtitle="Monthly" source="Internal">
        <div>chart body</div>
      </BoringChartFrame>,
    )

    expect(html).toContain("Revenue")
    expect(html).toContain("Monthly")
    expect(html).toContain("Internal")
    expect(html).toContain("chart body")
    expect(html).toContain("var(--border)")
  })

  it("renders duplicate tooltip payload entries without key collisions", () => {
    const html = renderToStaticMarkup(
      <BoringTooltip
        active
        label="Jan"
        payload={[
          { dataKey: "value", name: "Value", value: 1, color: "red" },
          { dataKey: "value", name: "Value", value: 2, color: "blue" },
        ]}
      />,
    )

    expect(html).toContain("Jan")
    expect(html.match(/Value/g)).toHaveLength(2)
  })

  it("exposes Recharts styling premises without chart wrappers", () => {
    expect(boringCartesianAxisProps.tick.fill).toBe("var(--muted-foreground)")
    expect(boringCartesianGridProps.stroke).toContain("var(--border)")
    expect(boringLegendProps.wrapperStyle.fontSize).toBe(12)
    expect(boringLineProps.connectNulls).toBe(true)
    expect(boringBarProps.radius).toEqual([6, 6, 2, 2])
    expect(boringReferenceAreaProps.fill).toContain("var(--accent)")
  })
})
