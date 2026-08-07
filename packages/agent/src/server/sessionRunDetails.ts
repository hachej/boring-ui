export interface AuthorizedSessionRunDetails {
  runId: string
  terminalEntryId: string
  state: 'success' | 'error' | 'aborted' | 'interrupted'
  createdAt?: string
  details: readonly unknown[]
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function terminalState(message: Record<string, unknown>): AuthorizedSessionRunDetails['state'] | undefined {
  if (message.runTerminalState === 'success' || message.runTerminalState === 'error' || message.runTerminalState === 'aborted' || message.runTerminalState === 'interrupted') {
    return message.runTerminalState
  }
  if (message.status === 'done') return 'success'
  if (message.status === 'error') return 'error'
  if (message.status === 'aborted') return 'aborted'
  return undefined
}

/** Redact a session snapshot to terminal run identity and allowlisted structured details. */
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
    if (message.role === 'user') {
      const runId = typeof message.piEntryId === 'string' ? message.piEntryId : typeof message.id === 'string' ? message.id : undefined
      active = runId ? { runId, details: [] } : null
      continue
    }
    if (message.role !== 'assistant' || !active) continue
    if (Array.isArray(message.parts)) {
      for (const rawPart of message.parts) {
        const part = recordValue(rawPart)
        if (!part || part.type !== 'tool-call' || part.state !== 'output-available') continue
        const output = recordValue(part.output)
        const root = recordValue(output?.details)
        const candidates = root
          ? [root, ...Object.values(root).map(recordValue).filter((value): value is Record<string, unknown> => value !== null)]
          : []
        for (const candidate of candidates) {
          if (typeof candidate.kind === 'string' && allowed.has(candidate.kind)) active.details.push(structuredClone(candidate))
        }
      }
    }
    const state = terminalState(message)
    if (!state) continue
    const terminalEntryId = typeof message.piEntryId === 'string' ? message.piEntryId : typeof message.id === 'string' ? message.id : undefined
    if (terminalEntryId) runs.push({
      runId: active.runId,
      terminalEntryId,
      state,
      ...(typeof message.createdAt === 'string' ? { createdAt: message.createdAt } : {}),
      details: active.details,
    })
    active = null
  }
  return runs
}
