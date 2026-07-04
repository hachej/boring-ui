import { describe, expect, it } from "vitest"
import { sampleBiDashboardSpec } from "../front/sampleSpec"
import { BI_DASHBOARD_DIAGNOSTIC_CODES, diagnoseDashboardSpec, validateDashboardSpec } from "./validation"

function cloneSample() {
  return structuredClone(sampleBiDashboardSpec)
}

describe("validateDashboardSpec", () => {
  it("accepts the sample dashboard spec", () => {
    expect(validateDashboardSpec(sampleBiDashboardSpec)).toEqual({ ok: true, errors: [] })
  })

  it("rejects missing query references", () => {
    const spec = cloneSample()
    const chart = spec.elements["people-role"]
    if (chart.type !== "BSLChart") throw new Error("bad fixture")
    chart.props.queryId = "missing_query"

    const result = validateDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("unknown query missing_query")
  })

  it("rejects dashboard component cycles", () => {
    const spec = cloneSample()
    const grid = spec.elements.dashboard
    if (grid.type !== "DashboardGrid") throw new Error("bad fixture")
    grid.children.push("dashboard")

    const result = validateDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("generated pane element cycle")
  })

  it("rejects malformed root objects instead of letting rendering crash", () => {
    const result = validateDashboardSpec({ kind: "boring.generated-pane", version: 1 })

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("generated pane root must be a string")
  })

  it("returns errors instead of throwing for malformed grid children", () => {
    const spec = cloneSample()
    const grid = spec.elements.dashboard as unknown as Record<string, unknown>
    delete grid.children

    const result = validateDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("must include string children")
  })

  it("rejects malformed Perspective props consumed by the renderer", () => {
    const spec = cloneSample()
    const table = spec.elements["people-table"] as unknown as { props: Record<string, unknown> }
    table.props.columns = "not-array"
    table.props.sort = "bad"

    const result = validateDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("people-table.props.columns")
    expect(result.errors.join("\n")).toContain("people-table.props.sort")
  })

  it("rejects malformed chart props consumed by the renderer", () => {
    const spec = cloneSample()
    const chart = spec.elements["people-role"] as unknown as { props: Record<string, unknown> }
    chart.props.title = { text: "bad" }
    chart.props.x = { field: "month" }
    chart.props.y = { field: "revenue" }

    const result = validateDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("people-role.props.title")
    expect(result.errors.join("\n")).toContain("people-role.props.x")
    expect(result.errors.join("\n")).toContain("people-role.props.y")
  })

  it("rejects stringified grid columns instead of silently coercing them", () => {
    const spec = cloneSample()
    const grid = spec.elements.dashboard as unknown as { props: Record<string, unknown> }
    grid.props.columns = "3"

    const result = validateDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.errors.join("\n")).toContain("dashboard.props.columns")
  })

  it("allows five-column indicator grids but warns when charts are denser than two columns", () => {
    const spec = cloneSample()
    const grid = spec.elements.dashboard as unknown as { props: Record<string, unknown> }
    grid.props.columns = 5

    const result = diagnoseDashboardSpec(spec)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: BI_DASHBOARD_DIAGNOSTIC_CODES.layoutChartsTooDense, elementId: "dashboard", severity: "warning" }),
    ]))
  })

  it("diagnoses chart category fields used as measures", () => {
    const spec = cloneSample()
    const chart = spec.elements["people-role"] as unknown as { props: Record<string, unknown> }
    chart.props.y = ["role", "count"]

    const result = diagnoseDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: BI_DASHBOARD_DIAGNOSTIC_CODES.chartCategoryAsMeasure, elementId: "people-role" }),
    ]))
  })

  it("uses canonical missing measure diagnostic code", () => {
    const spec = cloneSample()
    const chart = spec.elements["people-role"] as unknown as { props: Record<string, unknown> }
    delete chart.props.y

    const result = diagnoseDashboardSpec(spec)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: BI_DASHBOARD_DIAGNOSTIC_CODES.chartMeasureMissing, elementId: "people-role" }),
    ]))
    expect(result.diagnostics.map((item) => item.code)).not.toContain("chart.missing_measure")
  })
})
