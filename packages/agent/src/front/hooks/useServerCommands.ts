import { useEffect, useRef, useState } from 'react'
import type { CommandRegistry, SlashCommand } from '../slashCommands/registry'

interface ServerCommandSummary {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  sourcePlugin?: string
}

function toSlashCommand(command: ServerCommandSummary): SlashCommand {
  return {
    name: command.name,
    description: command.description ?? '',
    kind: 'server',
    source: command.source,
    ...(command.sourcePlugin ? { sourcePlugin: command.sourcePlugin } : {}),
    handler: () => {},
  }
}

export function useServerCommands({
  registry,
  requestHeaders,
  sessionId,
  enabled = true,
  refreshKey = 0,
}: {
  registry: CommandRegistry
  requestHeaders?: Record<string, string>
  sessionId: string
  enabled?: boolean
  refreshKey?: number
}): number {
  const [stamp, setStamp] = useState(0)
  const registeredNamesRef = useRef<Set<string>>(new Set())

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
    const url = `/api/v1/agent/commands?sessionId=${encodeURIComponent(sessionId)}`

    fetch(url, { headers: requestHeaders })
      .then(async (res) => {
        if (!res.ok) throw new Error(`commands request failed (${res.status})`)
        return await res.json() as { commands?: ServerCommandSummary[] }
      })
      .then((payload) => {
        if (aborted) return

        const removed = clearRegistered()
        let added = false
        for (const serverCommand of payload.commands ?? []) {
          const command = toSlashCommand(serverCommand)
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
  }, [enabled, refreshKey, requestHeaders, registry, sessionId])

  return stamp
}
