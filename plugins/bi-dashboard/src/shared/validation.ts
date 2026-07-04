import { validateGeneratedPaneSpec } from "@hachej/boring-generated-pane/shared"
import type { BslDashboardSpec } from "./types"
import { biDashboardVocabulary, componentPropsSchemas, dashboardQuerySchema } from "./schemas"

export interface DashboardValidationResult {
  spec: BslDashboardSpec | null
  errors: string[]
}

<<<<<<< Updated upstream
export type DashboardDiagnosticSeverity = "error" | "warning" | "info"

export const BI_DASHBOARD_DIAGNOSTIC_CODES = {
  dashboardSchema: "dashboard.schema",
  queryUnknown: "query.unknown",
  filterTargetUnknown: "filter.target_unknown",
  chartCategoryAsMeasure: "chart.category_as_measure",
  chartCategoryMissing: "chart.category_missing",
  chartMeasureMissing: "chart.measure_missing",
  perspectiveGroupFieldInColumns: "perspective.group_field_in_columns",
  layoutControlsTop: "layout.controls_top",
  layoutChartsTooDense: "layout.charts_too_dense",
} as const

export type DashboardDiagnosticCode = typeof BI_DASHBOARD_DIAGNOSTIC_CODES[keyof typeof BI_DASHBOARD_DIAGNOSTIC_CODES]

export interface DashboardDiagnostic {
  severity: DashboardDiagnosticSeverity
  code: DashboardDiagnosticCode | string
  message: string
  elementId?: string
  queryId?: string
}

export interface DashboardDiagnosticsResult {
  ok: boolean
  diagnostics: DashboardDiagnostic[]
}

=======
>>>>>>> Stashed changes
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function schemaPath(path: PropertyKey[]): string {
  return path.length ? `.${path.map(String).join(".")}` : ""
}

function formatSchemaDiagnostics(prefix: string, error: { issues: Array<{ path: PropertyKey[]; message: string }> }): DashboardDiagnostic[] {
  return error.issues.map((issue) => ({
    severity: "error",
    code: BI_DASHBOARD_DIAGNOSTIC_CODES.dashboardSchema,
    message: `${prefix}${schemaPath(issue.path)}: ${issue.message}`,
  }))
}

<<<<<<< Updated upstream
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

function staticDashboardDiagnostics(spec: BslDashboardSpec): DashboardDiagnostic[] {
  const diagnostics: DashboardDiagnostic[] = []
  const queries = spec.queries

  for (const [elementId, element] of Object.entries(spec.elements)) {
    const type = element.type as keyof typeof componentPropsSchemas
    const props: Record<string, unknown> = element.props

    if (type === "DashboardGrid" && !Array.isArray(element.children)) {
      diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.dashboardSchema, elementId, message: `DashboardGrid ${elementId} must include string children` })
    }

    if ((type === "BSLMetric" || type === "BSLChart" || type === "BSLPerspectiveViewer") && "queryId" in props) {
      const queryId = String(props.queryId)
      if (!queries[queryId]) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.queryUnknown, elementId, queryId, message: `component ${elementId} references unknown query ${queryId}` })
    }

    if (type === "BSLFilter" && Array.isArray(props.targetQueries)) {
      for (const queryId of (props.targetQueries as unknown[]).map(String)) {
        if (!queries[queryId]) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.filterTargetUnknown, elementId, queryId, message: `BSLFilter ${elementId} references unknown query ${queryId}` })
      }
    }

    if (type === "BSLChart") {
      const x = typeof props.x === "string" ? props.x : undefined
      const y = Array.isArray(props.y) ? props.y : typeof props.y === "string" ? [props.y] : []
      if (y.length === 0) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.chartMeasureMissing, elementId, message: "BSLChart must set props.y to at least one numeric measure field." })
      if (x && y.includes(x)) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.chartCategoryAsMeasure, elementId, message: `BSLChart props.y must not include category field ${x}; keep it only in props.x.` })
      const queryId = String(props.queryId)
      const query = spec.queries[queryId]
      if (query && "sql" in query) {
        const returned = new Set(queryColumnsFromSql(query.sql))
        if (x && returned.size > 0 && !returned.has(x)) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.chartCategoryMissing, elementId, queryId: query.id, message: `Chart category field ${x} is not returned by query ${query.id}.` })
        for (const field of y) {
          if (returned.size > 0 && !returned.has(field)) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.chartMeasureMissing, elementId, queryId: query.id, message: `Chart measure field ${field} is not returned by query ${query.id}.` })
        }
      }
    }

    if (type === "BSLPerspectiveViewer") {
      const plugin = String(props.plugin ?? "Datagrid")
      const groupBy = new Set(Array.isArray(props.groupBy) ? props.groupBy : [])
      const columns = Array.isArray(props.columns) ? props.columns : []
      if (!/datagrid/i.test(plugin)) {
        for (const column of columns) {
          if (groupBy.has(column)) diagnostics.push({ severity: "warning", code: BI_DASHBOARD_DIAGNOSTIC_CODES.perspectiveGroupFieldInColumns, elementId, message: `Perspective chart groups by ${column}; keep grouped/category fields out of measure columns.` })
        }
      }
    }
  }

  const grid = spec.elements[spec.root]
  if (grid?.type === "DashboardGrid" && Array.isArray(grid.children)) {
    const children = grid.children
    const firstNonFilter = children.findIndex((id) => spec.elements[id]?.type !== "BSLFilter" && spec.elements[id]?.type !== "BSLText")
    const lateFilter = children.find((id, index) => index > Math.max(0, firstNonFilter) && spec.elements[id]?.type === "BSLFilter")
    if (lateFilter) diagnostics.push({ severity: "info", code: BI_DASHBOARD_DIAGNOSTIC_CODES.layoutControlsTop, elementId: lateFilter, message: "Filters/controllers render in the top controls bar; keep them early in dashboard children for readability." })
    const gridColumns = Number(grid.props?.columns ?? 1)
    const hasCharts = children.some((id) => spec.elements[id]?.type === "BSLChart" || spec.elements[id]?.type === "BSLPerspectiveViewer")
    if (hasCharts && gridColumns > 2) {
      diagnostics.push({ severity: "warning", code: BI_DASHBOARD_DIAGNOSTIC_CODES.layoutChartsTooDense, elementId: spec.root, message: "Dashboards with charts should use DashboardGrid props.columns <= 2; reserve 3-5 columns for compact indicator/KPI grids." })
    }
  }

  return diagnostics
}

export function diagnoseDashboardSpec(value: unknown): DashboardDiagnosticsResult {
  const generated = validateGeneratedPaneSpec(value, biDashboardVocabulary)
  const diagnostics: DashboardDiagnostic[] = generated.diagnostics.map((item) => ({
    severity: item.severity,
    code: item.code,
    message: item.message,
    elementId: item.elementId,
  }))

  if (!generated.spec) return { ok: false, diagnostics }

  if (generated.spec.profile !== "bi-dashboard") {
    diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.dashboardSchema, message: 'dashboard spec profile must be "bi-dashboard"' })
  }
  if (typeof generated.spec.title !== "string" || generated.spec.title.length === 0) {
    diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.dashboardSchema, message: "dashboard spec needs a title" })
  }
  if (!isRecord(generated.spec.queries)) {
    diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.dashboardSchema, message: "dashboard spec needs a queries object" })
  }

  if (!isRecord(generated.spec.queries)) return { ok: false, diagnostics }
  const queries = generated.spec.queries as Record<string, unknown>
  for (const [id, query] of Object.entries(queries)) {
    const parsed = dashboardQuerySchema.safeParse(query)
    if (!parsed.success) {
      diagnostics.push(...formatSchemaDiagnostics(`query ${id}`, parsed.error))
      continue
    }
    if (parsed.data.id !== id) diagnostics.push({ severity: "error", code: BI_DASHBOARD_DIAGNOSTIC_CODES.dashboardSchema, queryId: id, message: `query ${id} must repeat its id field` })
  }

  if (diagnostics.some((item) => item.severity === "error")) return { ok: false, diagnostics }
  const spec = generated.spec as BslDashboardSpec
  diagnostics.push(...staticDashboardDiagnostics(spec))
  return { ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"), diagnostics }
}

export function parseDashboardSpec(value: unknown): DashboardValidationResult {
  const result = diagnoseDashboardSpec(value)
  const errors = result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message)
  if (errors.length > 0) return { spec: null, errors }
  return { spec: validateGeneratedPaneSpec(value, biDashboardVocabulary).spec as BslDashboardSpec, errors: [] }
}

=======
>>>>>>> Stashed changes
export function validateDashboardSpec(value: unknown): { ok: boolean; errors: string[] } {
  const result = parseDashboardSpec(value)
  return { ok: result.spec !== null, errors: result.errors }
}
