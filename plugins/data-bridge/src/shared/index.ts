export const DATA_BRIDGE_QUERY_RUN_OP = "data.v1.query.run" as const
export const DATA_BRIDGE_QUERY_BATCH_OP = "data.v1.query.batch" as const

export type DataBridgeScalarType = "string" | "integer" | "float" | "boolean" | "date" | "datetime" | "json"
export type DataBridgeRole = "dimension" | "measure" | "time" | "unknown"
export type DataBridgeQueryFormat = "json" | "arrow"

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
  /** Defaults to json. Dashboards request arrow for local Perspective snapshot viewers. */
  format?: DataBridgeQueryFormat
}

export interface DataBridgeQueryBatchItemInput {
  id: string
  input: DataBridgeQueryRunInput
}

export interface DataBridgeQueryBatchInput {
  queries: DataBridgeQueryBatchItemInput[]
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

export interface DataBridgeArrowResult {
  kind: "data-bridge.arrow"
  version: 1
  /** Base64-encoded Apache Arrow IPC bytes, safe to carry over JSON RPC. */
  arrowBase64: string
  columns?: DataBridgeColumn[]
  rowCount?: number
  truncated?: boolean
  source?: string
}

export type DataBridgeQueryRunOutput = DataBridgeTableResult | DataBridgeArrowResult

export type DataBridgeQueryBatchItemResult =
  | {
    id: string
    ok: true
    output: DataBridgeQueryRunOutput
  }
  | {
    id: string
    ok: false
    error: { message: string }
  }

export interface DataBridgeQueryBatchOutput {
  kind: "data-bridge.batch"
  version: 1
  results: DataBridgeQueryBatchItemResult[]
}
