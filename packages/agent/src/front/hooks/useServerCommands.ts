import { useEffect, useRef, useState } from 'react'
import { WORKSPACE_COMMAND_NOTIFY_EVENT } from '../../shared/agentPluginEvents'
import type { CommandRegistry, SlashCommand } from '../slashCommands/registry'

interface ServerCommandSummary {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  sourcePlugin?: string
}

function toSlashCommand(
  command: ServerCommandSummary,
  sessionId: string,
  apiBaseUrl: string | undefined,
  requestHeaders: Record<string, string> | undefined,
): SlashCommand {
  return {
    name: command.name,
    description: command.description ?? '',
    source: command.source,
    ...(command.sourcePlugin ? { sourcePlugin: command.sourcePlugin } : {}),
    handler: async () => {
      const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
      const url = `${base}/api/v1/agent/commands/execute?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(command.name)}`
      try {
        const res = await fetch(url, { method: 'POST', headers: requestHeaders })
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string }
          if (typeof globalThis.dispatchEvent === 'function') {
            globalThis.dispatchEvent(new CustomEvent(WORKSPACE_COMMAND_NOTIFY_EVENT, {
              detail: { message: body.error ?? `/${command.name} failed`, tone: 'error', command: command.name },
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
  apiBaseUrl,
  fetch: fetchImpl,
  storageScope,
  enabled = true,
  refreshKey = 0,
}: {
  registry: CommandRegistry
  requestHeaders?: Record<string, string>
  sessionId: string
  apiBaseUrl?: string
  fetch?: typeof globalThis.fetch
  storageScope?: string
  enabled?: boolean
  refreshKey?: number
}): number {
  const [stamp, setStamp] = useState(0)
  const registeredNamesRef = useRef<Set<string>>(new Set())
  // Keep sessionId in a ref so discovery doesn't re-run when only the session
  // ID changes — sessionId is only needed at execute time (passed via closure).
  const sessionIdRef = useRef(sessionId)
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  useEffect(() => {
    const clearRegistered = () => {
      if (registeredNamesRef.current.size === 0) return false
      for (const name of registeredNamesRef.current) registry.unregister(name)
      registeredNamesRef.current = new Set()
      return true
    }

    if (!enabled) {
      if (clearRegistered()) setStamp((n) => n + 1)
      return
    }

    let aborted = false
    const nextFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
    const url = `${base}/api/v1/agent/commands?sessionId=${encodeURIComponent(sessionIdRef.current)}`
    const headers = scopedHeaders(requestHeaders, storageScope)

    nextFetch(url, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`commands request failed (${res.status})`)
        return await res.json() as { commands?: ServerCommandSummary[] }
      })
      .then((payload) => {
        if (aborted) return

        const removed = clearRegistered()
        let added = false
        for (const serverCommand of payload.commands ?? []) {
          const command = toSlashCommand(serverCommand, sessionIdRef.current, apiBaseUrl, requestHeaders)
          if (registry.get(command.name)) continue
          registry.register(command)
          registeredNamesRef.current.add(command.name)
          added = true
        }
        if (removed || added) setStamp((n) => n + 1)
      })
      .catch(() => {
        if (aborted) return
        if (clearRegistered()) setStamp((n) => n + 1)
      })

    return () => { aborted = true }
  }, [apiBaseUrl, enabled, fetchImpl, refreshKey, requestHeaders, registry, storageScope])

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
