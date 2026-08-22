import { OBJECTIVE_BRIDGE_OPS } from "../shared/bridge"
import type {
  CreateObjectiveInput,
  Objective,
  ObjectiveStatus,
  UpdateObjectiveInput,
} from "../shared/types"

export type ObjectivesClientOptions = { apiBaseUrl?: string; headers?: Record<string, string> }

type BridgeResponse<T> =
  | { ok: true; output: T }
  | { ok: false; error?: { code?: string; message?: string } }

export class ObjectivesClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 0) {
    super(message)
  }
}

export function createObjectivesClient(options: ObjectivesClientOptions = {}) {
  async function callBridge<T>(op: string, input: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${options.apiBaseUrl ?? ""}/api/v1/workspace-bridge/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Core's browser bridge policy requires a non-empty non-simple header
        // as CSRF proof; its stock policy checks presence, not a secret value.
        "x-csrf-token": "browser",
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({ op, input }),
    })
    const payload = await response.json().catch(() => ({})) as BridgeResponse<T>
    if (!response.ok || !("ok" in payload) || !payload.ok) {
      const error = "error" in payload ? payload.error : undefined
      throw new ObjectivesClientError(
        error?.code ?? "OBJECTIVES_BRIDGE_UNAVAILABLE",
        error?.message ?? "Objectives bridge call failed",
        response.status,
      )
    }
    return payload.output
  }

  return {
    async list(status?: ObjectiveStatus): Promise<Objective[]> {
      const output = await callBridge<{ objectives: Objective[] }>(OBJECTIVE_BRIDGE_OPS.list, status ? { status } : {})
      return output.objectives
    },
    async get(id: string): Promise<Objective | null> {
      const output = await callBridge<{ objective: Objective | null }>(OBJECTIVE_BRIDGE_OPS.get, { id })
      return output.objective
    },
    async create(input: CreateObjectiveInput): Promise<Objective> {
      const output = await callBridge<{ objective: Objective }>(OBJECTIVE_BRIDGE_OPS.create, input as unknown as Record<string, unknown>)
      return output.objective
    },
    async update(input: UpdateObjectiveInput): Promise<Objective> {
      const output = await callBridge<{ objective: Objective }>(OBJECTIVE_BRIDGE_OPS.update, input as unknown as Record<string, unknown>)
      return output.objective
    },
  }
}
