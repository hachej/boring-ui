import { parseGeneratedPaneSpec } from "@hachej/boring-generated-pane/shared"
import type { BslDashboardSpec } from "./types"
import { componentPropsSchemas, dashboardQuerySchema } from "./schemas"

export interface DashboardValidationResult {
  spec: BslDashboardSpec | null
  errors: string[]
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

export function validateDashboardSpec(value: unknown): { ok: boolean; errors: string[] } {
  const result = parseDashboardSpec(value)
  return { ok: result.spec !== null, errors: result.errors }
}
