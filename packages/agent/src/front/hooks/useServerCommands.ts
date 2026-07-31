import { useEffect, useRef, useState } from 'react'
import { WORKSPACE_COMMAND_NOTIFY_EVENT } from '../../shared/agentPluginEvents'
import type { CommandRegistry, SlashCommand } from '../slashCommands/registry'

interface ServerCommandSummary {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  sourcePlugin?: string
}

interface ServerCommandErrorBody {
  error?: string | { message?: unknown }
}

function serverCommandErrorMessage(body: ServerCommandErrorBody, fallback: string): string {
  if (typeof body.error === 'string') return body.error
  if (body.error && typeof body.error === 'object' && typeof body.error.message === 'string') return body.error.message
  return fallback
}

/**
 * A pane addressed to a specific agent MUST use that agent's routes. The legacy
 * `/api/v1/agent/commands*` routes are bound to the host's default agent, so a
 * non-default pane would otherwise discover and execute the wrong agent's
 * commands against its own session id.
 */
function commandsUrl(
  base: string,
  sessionId: string,
  agentTypeId: string | undefined,
  suffix: '' | '/execute',
): string {
  if (agentTypeId) {
    return `${base}/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/commands${suffix}`
  }
  const params = new URLSearchParams({ sessionId })
  return `${base}/api/v1/agent/commands${suffix}?${params.toString()}`
}

function toSlashCommand(
  command: ServerCommandSummary,
  identity: { key: string; sessionId: string; agentTypeId: string | undefined },
  isCurrentIdentity: (key: string) => boolean,
  apiBaseUrl: string | undefined,
  requestHeaders: Record<string, string> | undefined,
  fetchImpl: typeof globalThis.fetch,
): SlashCommand {
  return {
    name: command.name,
    description: command.description ?? '',
    source: command.source,
    ...(command.sourcePlugin ? { sourcePlugin: command.sourcePlugin } : {}),
    handler: async (args) => {
      if (!isCurrentIdentity(identity.key)) return
      const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
      const url = commandsUrl(base, identity.sessionId, identity.agentTypeId, '/execute')
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { ...(requestHeaders ?? {}), 'content-type': 'application/json' },
          body: JSON.stringify({ name: command.name, args }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as ServerCommandErrorBody
          if (typeof globalThis.dispatchEvent === 'function') {
            globalThis.dispatchEvent(new CustomEvent(WORKSPACE_COMMAND_NOTIFY_EVENT, {
              detail: { message: serverCommandErrorMessage(body, `/${command.name} failed`), tone: 'error', command: command.name },
            }))
          }
        }
      } catch {
        if (typeof globalThis.dispatchEvent === 'function') {
          globalThis.dispatchEvent(new CustomEvent(WORKSPACE_COMMAND_NOTIFY_EVENT, {
            detail: { message: `/${command.name} could not be reached`, tone: 'error', command: command.name },
          }))
        }
      }
    },
  }
}

export function useServerCommands({
  registry,
  requestHeaders,
  sessionId,
  agentTypeId,
  apiBaseUrl,
  fetch: fetchImpl,
  storageScope,
  enabled = true,
  refreshKey = 0,
}: {
  registry: CommandRegistry
  requestHeaders?: Record<string, string>
  sessionId?: string
  /** Owning agent type in addressed hosts. Absent on the legacy single-agent wire. */
  agentTypeId?: string
  apiBaseUrl?: string
  fetch?: typeof globalThis.fetch
  storageScope?: string
  enabled?: boolean
  refreshKey?: number
}): number {
  const [stamp, setStamp] = useState(0)
  const registrationsRef = useRef<{
    registry: CommandRegistry
    identity: string | undefined
    names: Set<string>
  }>({ registry, identity: undefined, names: new Set() })
  const canonicalSessionId = sessionId?.trim() || undefined
  const identityKey = canonicalSessionId ? `${agentTypeId ?? ''}\u0000${canonicalSessionId}` : undefined
  // Render-time update makes stale handlers fail closed before effect cleanup.
  const identityKeyRef = useRef<string | undefined>(identityKey)
  identityKeyRef.current = identityKey

  useEffect(() => {
    const clearRegistered = () => {
      const registrations = registrationsRef.current
      for (const name of registrations.names) registrations.registry.unregister(name)
      const changed = registrations.names.size > 0
      registrationsRef.current = { registry, identity: undefined, names: new Set() }
      return changed
    }

    if (registrationsRef.current.registry !== registry) {
      if (clearRegistered()) setStamp((n) => n + 1)
    }

    if (!enabled || !canonicalSessionId || !identityKey) {
      if (clearRegistered()) setStamp((n) => n + 1)
      return
    }

    if (registrationsRef.current.identity !== identityKey) {
      if (clearRegistered()) setStamp((n) => n + 1)
    }

    let aborted = false
    const nextFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
    const url = commandsUrl(base, canonicalSessionId, agentTypeId, '')
    const headers = scopedHeaders(requestHeaders, storageScope)

    nextFetch(url, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`commands request failed (${res.status})`)
        return await res.json() as { commands?: ServerCommandSummary[] }
      })
      .then((payload) => {
        if (aborted) return

        const removed = clearRegistered()
        const registeredNames = new Set<string>()
        let added = false
        for (const serverCommand of payload.commands ?? []) {
          const command = toSlashCommand(
            serverCommand,
            { key: identityKey, sessionId: canonicalSessionId, agentTypeId },
            (key) => identityKeyRef.current === key,
            apiBaseUrl,
            headers,
            nextFetch,
          )
          if (registry.get(command.name)) continue
          registry.register(command)
          registeredNames.add(command.name)
          added = true
        }
        registrationsRef.current = { registry, identity: identityKey, names: registeredNames }
        if (removed || added) setStamp((n) => n + 1)
      })
      .catch(() => {
        if (aborted) return
        if (clearRegistered()) setStamp((n) => n + 1)
      })

    return () => { aborted = true }
  }, [agentTypeId, apiBaseUrl, canonicalSessionId, enabled, fetchImpl, identityKey, refreshKey, requestHeaders, registry, storageScope])

  return stamp
}

function scopedHeaders(
  headers: Record<string, string> | undefined,
  storageScope: string | undefined,
): Record<string, string> | undefined {
  if (!headers && !storageScope) return undefined
  const result: Record<string, string> = { ...(headers ?? {}) }
  const hasScope = Object.keys(result).some((k) => k.toLowerCase() === 'x-boring-storage-scope')
  if (storageScope && !hasScope) result['x-boring-storage-scope'] = storageScope
  return result
}
