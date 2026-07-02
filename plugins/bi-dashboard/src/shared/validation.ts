import { parseGeneratedPaneSpec } from "@hachej/boring-generated-pane/shared"
import type { BslDashboardSpec } from "./types"
import { componentPropsSchemas, dashboardQuerySchema } from "./schemas"

export interface DashboardValidationResult {
  spec: BslDashboardSpec | null
  errors: string[]
}

export type DashboardDiagnosticSeverity = "error" | "warning" | "info"

export interface DashboardDiagnostic {
  severity: DashboardDiagnosticSeverity
  code: string
  message: string
  elementId?: string
  queryId?: string
}

export interface DashboardDiagnosticsResult {
  ok: boolean
  diagnostics: DashboardDiagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatSchemaErrors(prefix: string, error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.map((issue) => `${prefix}${issue.path.length ? `.${issue.path.map(String).join(".")}` : ""}: ${issue.message}`)
}

export function parseDashboardSpec(value: unknown): DashboardValidationResult {
  const base = parseGeneratedPaneSpec(value)
  if (!base.spec) return { spec: null, errors: base.errors }

  const errors: string[] = []
  if (base.spec.profile !== "bi-dashboard") errors.push('dashboard spec profile must be "bi-dashboard"')
  if (typeof base.spec.title !== "string" || base.spec.title.length === 0) errors.push("dashboard spec needs a title")
  if (!isRecord(base.spec.queries)) errors.push("dashboard spec needs a queries object")
  if (errors.length > 0) return { spec: null, errors }

  const queries = base.spec.queries as Record<string, unknown>
  for (const [id, query] of Object.entries(queries)) {
    const parsed = dashboardQuerySchema.safeParse(query)
    if (!parsed.success) {
      errors.push(...formatSchemaErrors(`query ${id}`, parsed.error))
      continue
    }
    if (parsed.data.id !== id) errors.push(`query ${id} must repeat its id field`)
  }

  for (const [id, element] of Object.entries(base.spec.elements)) {
    const type = element.type as keyof typeof componentPropsSchemas
    const schema = componentPropsSchemas[type]
    if (!schema) {
      errors.push(`component ${id} has unsupported type ${String(element.type)}`)
      continue
    }
    const props = schema.safeParse(element.props ?? {})
    if (!props.success) errors.push(...formatSchemaErrors(`component ${id}.props`, props.error))

    if (type === "DashboardGrid" && !Array.isArray(element.children)) {
      errors.push(`DashboardGrid ${id} must include string children`)
    }
    if ((type === "BSLMetric" || type === "BSLChart" || type === "BSLPerspectiveViewer") && props.success) {
      const queryId = (props.data as { queryId: string }).queryId
      if (!queries[queryId]) errors.push(`component ${id} references unknown query ${queryId}`)
    }
    if (type === "BSLFilter" && props.success) {
      for (const queryId of (props.data as { targetQueries: string[] }).targetQueries) {
        if (!queries[queryId]) errors.push(`BSLFilter ${id} references unknown query ${queryId}`)
      }
    }
  }

  if (errors.length > 0) return { spec: null, errors }
  return { spec: base.spec as BslDashboardSpec, errors: [] }
}

function queryColumnsFromSql(sql: string): string[] {
  const match = /^\s*select\s+([\s\S]+?)\s+from\s+/i.exec(sql)
  if (!match) return []
  return match[1].split(",").map((part) => {
    const asMatch = /\s+as\s+([\w$]+)\s*$/i.exec(part)
    if (asMatch) return asMatch[1]
    const trimmed = part.trim()
    const bare = /([\w$]+)\s*$/.exec(trimmed)?.[1]
    return bare ?? trimmed
  }).filter(Boolean)
}

export function diagnoseDashboardSpec(value: unknown): DashboardDiagnosticsResult {
  const result = parseDashboardSpec(value)
  const diagnostics: DashboardDiagnostic[] = result.errors.map((message) => ({ severity: "error", code: "dashboard.schema", message }))
  if (!result.spec) return { ok: false, diagnostics }

  const spec = result.spec
  for (const [elementId, element] of Object.entries(spec.elements)) {
    if (element.type === "BSLChart") {
      const props = element.props
      const x = typeof props.x === "string" ? props.x : undefined
      const y = Array.isArray(props.y) ? props.y : typeof props.y === "string" ? [props.y] : []
      if (!x) diagnostics.push({ severity: "warning", code: "chart.missing_category", elementId, message: "BSLChart should set props.x to the category/grouping field." })
      if (y.length === 0) diagnostics.push({ severity: "error", code: "chart.missing_measure", elementId, message: "BSLChart must set props.y to at least one numeric measure field." })
      if (x && y.includes(x)) diagnostics.push({ severity: "error", code: "chart.category_as_measure", elementId, message: `BSLChart props.y must not include category field ${x}; keep it only in props.x.` })
      const query = spec.queries[String(props.queryId)]
      if (query && "sql" in query) {
        const returned = new Set(queryColumnsFromSql(query.sql))
        if (x && returned.size > 0 && !returned.has(x)) diagnostics.push({ severity: "error", code: "chart.category_missing", elementId, queryId: query.id, message: `Chart category field ${x} is not returned by query ${query.id}.` })
        for (const field of y) {
          if (returned.size > 0 && !returned.has(field)) diagnostics.push({ severity: "error", code: "chart.measure_missing", elementId, queryId: query.id, message: `Chart measure field ${field} is not returned by query ${query.id}.` })
        }
      }
    }
    if (element.type === "BSLPerspectiveViewer") {
      const props = element.props
      const plugin = String(props.plugin ?? "Datagrid")
      const groupBy = new Set(Array.isArray(props.groupBy) ? props.groupBy : [])
      const columns = Array.isArray(props.columns) ? props.columns : []
      if (!/datagrid/i.test(plugin)) {
        for (const column of columns) {
          if (groupBy.has(column)) diagnostics.push({ severity: "warning", code: "perspective.group_field_in_columns", elementId, message: `Perspective chart groups by ${column}; keep grouped/category fields out of measure columns.` })
        }
      }
    }
  }

  const grid = spec.elements[spec.root]
  if (grid?.type === "DashboardGrid" && Array.isArray(grid.children)) {
    const children = grid.children
    const firstNonFilter = children.findIndex((id) => spec.elements[id]?.type !== "BSLFilter" && spec.elements[id]?.type !== "BSLText")
    const lateFilter = children.find((id, index) => index > Math.max(0, firstNonFilter) && spec.elements[id]?.type === "BSLFilter")
    if (lateFilter) diagnostics.push({ severity: "info", code: "layout.controls_top", elementId: lateFilter, message: "Filters/controllers render in the top controls bar; keep them early in dashboard children for readability." })
  }

  return { ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"), diagnostics }
}

export function validateDashboardSpec(value: unknown): { ok: boolean; errors: string[] } {
  const result = parseDashboardSpec(value)
  return { ok: result.spec !== null, errors: result.errors }
}
