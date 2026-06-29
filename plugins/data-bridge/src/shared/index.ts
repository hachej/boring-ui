export const DATA_BRIDGE_QUERY_RUN_OP = "data.v1.query.run" as const

export type DataBridgeScalarType = "string" | "integer" | "float" | "boolean" | "date" | "datetime" | "json"
export type DataBridgeRole = "dimension" | "measure" | "time" | "unknown"

export interface DataBridgeColumn {
  name: string
  type: DataBridgeScalarType
  role?: DataBridgeRole
}

export interface DataBridgeFilterExpression {
  field: string
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "between"
  value: unknown
}

export interface DataBridgeDashboardQuery {
  language: "bsl-dashboard"
  model: string
  groupBy?: string[]
  measures?: string[]
  dimensions?: string[]
  filters?: DataBridgeFilterExpression[]
  orderBy?: Array<[field: string, direction: "asc" | "desc"]>
  limit?: number
  dataRef?: {
    kind: "workspace-file"
    path: string
    limit?: number
  }
}

export interface DataBridgeBslPythonQuery {
  language: "bsl-python"
  model: string
  query: string
  limit?: number
}

export interface DataBridgeSqlQuery {
  language: "sql"
  source: string
  sql: string
  params?: Record<string, unknown>
  limit?: number
}

export type DataBridgeQuery = DataBridgeDashboardQuery | DataBridgeBslPythonQuery | DataBridgeSqlQuery

export interface DataBridgeQueryRunInput {
  source?: string
  query: DataBridgeQuery
}

export interface DataBridgeTableResult {
  kind: "data-bridge.table"
  version: 1
  columns: DataBridgeColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated?: boolean
  source?: string
}
