export interface AgentCliErrorV1 {
  schemaVersion: 1
  ok: false
  error: {
    code: string
    field?: string
    message: string
  }
}
