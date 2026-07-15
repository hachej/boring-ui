import { useEffect, useState } from 'react'
import type { CommandRegistry } from '../slashCommands/registry'

export function useServerSkills({
  apiBaseUrl,
  fetch: fetchImpl,
  registry,
  requestHeaders,
  storageScope,
  refreshKey,
  enabled = true,
}: {
  apiBaseUrl?: string
  fetch?: typeof globalThis.fetch
  registry: CommandRegistry
  requestHeaders?: Record<string, string>
  storageScope?: string
  refreshKey?: unknown
  enabled?: boolean
}): number {
  // Bumped when server skills are added to registry so the picker re-renders.
  const [skillsStamp, setSkillsStamp] = useState(0)

  // Fetch PI skills and register them so the slash picker shows them without
  // host apps needing to hardcode them in extraCommands. Server skills never
  // overwrite builtins or host-provided extraCommands (first-write wins).
  useEffect(() => {
    if (!enabled) return
    let aborted = false
    const nextFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    const path = refreshKey ? '/api/v1/agent/skills?refresh=1' : '/api/v1/agent/skills'
    nextFetch(agentResourceUrl(apiBaseUrl, path), {
      headers: scopedHeaders(requestHeaders, storageScope),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { skills?: Array<{ name: string; description: string }> } | null) => {
        if (aborted || !payload?.skills) return
        let added = 0
        for (const skill of payload.skills) {
          if (!registry.get(skill.name)) {
            registry.register({ name: skill.name, description: skill.description, kind: 'skill', source: 'skill', handler: () => {} })
            added++
          }
        }
        if (added > 0) setSkillsStamp((n) => n + 1)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [apiBaseUrl, enabled, fetchImpl, refreshKey, requestHeaders, registry, storageScope])

  return skillsStamp
}

function agentResourceUrl(apiBaseUrl: string | undefined, path: string): string {
  const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
  return `${base}${path}`
}

function scopedHeaders(headers: Record<string, string> | undefined, _storageScope: string | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  return { ...headers }
}
