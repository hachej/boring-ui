import type { AuthorizedSessionRunDetails } from "./workspaceAgentDispatcher"

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * Redact a native-session snapshot to run identity, terminal state, and the
 * explicitly allowlisted structured detail nodes required by trusted hosts.
 */
export function projectAuthorizedSessionRunDetails(
  messages: readonly unknown[],
  detailKinds: readonly string[],
): AuthorizedSessionRunDetails[] {
  const allowed = new Set(detailKinds)
  const runs: AuthorizedSessionRunDetails[] = []
  let active: { runId: string; details: unknown[] } | null = null
  for (const rawMessage of messages) {
    const message = recordValue(rawMessage)
    if (!message) continue
    if (message.role === "user") {
      const runId = typeof message.piEntryId === "string" ? message.piEntryId : typeof message.id === "string" ? message.id : undefined
      active = runId ? { runId, details: [] } : null
      continue
    }
    if (message.role !== "assistant" || !active) continue
    if (Array.isArray(message.parts)) {
      for (const rawPart of message.parts) {
        const part = recordValue(rawPart)
        if (!part || part.type !== "tool-call" || part.state !== "output-available") continue
        const output = recordValue(part.output)
        const root = recordValue(output?.details)
        const candidates = root
          ? [root, ...Object.values(root).map(recordValue).filter((value): value is Record<string, unknown> => value !== null)]
          : []
        for (const candidate of candidates) {
          if (typeof candidate.kind === "string" && allowed.has(candidate.kind)) active.details.push(structuredClone(candidate))
        }
      }
    }
    const state = message.runTerminalState
    if (state === "success" || state === "error" || state === "aborted" || state === "interrupted") {
      const terminalEntryId = typeof message.piEntryId === "string" ? message.piEntryId : typeof message.id === "string" ? message.id : undefined
      if (terminalEntryId) runs.push({
        runId: active.runId,
        terminalEntryId,
        state,
        ...(typeof message.createdAt === "string" ? { createdAt: message.createdAt } : {}),
        details: active.details,
      })
      active = null
    }
  }
  return runs
}
