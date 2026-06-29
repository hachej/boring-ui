export const DATA_BRIDGE_QUERY_RUN_OP = "data.v1.query.run" as const

export type DataBridgeScalarType = "string" | "integer" | "float" | "boolean" | "date" | "datetime" | "json"
export type DataBridgeRole = "dimension" | "measure" | "time" | "unknown"

export interface DataBridgeColumn {
  name: string
  type: DataBridgeScalarType
  role?: DataBridgeRole
}

export interface DataBridgeBslQuery {
  language: "bsl"
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

export type DataBridgeQuery = DataBridgeBslQuery | DataBridgeSqlQuery

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
