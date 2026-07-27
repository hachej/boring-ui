import { useEffect, useState } from 'react'
import type { AgentSkillResource } from '../../shared/skill-resource'
import type { CommandRegistry, SlashCommand } from '../slashCommands/registry'

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
  const requestHeadersJson = JSON.stringify(Object.fromEntries(
    Object.entries(requestHeaders ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  ))
  useEffect(() => {
    if (!enabled) return
    let aborted = false
    const ownedCommands: SlashCommand[] = []
    const currentHeaders = JSON.parse(requestHeadersJson) as Record<string, string>
    const nextFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    const path = refreshKey ? '/api/v1/agent/skills?refresh=1' : '/api/v1/agent/skills'
    nextFetch(agentResourceUrl(apiBaseUrl, path), {
      headers: scopedHeaders(currentHeaders, storageScope),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { skills?: Array<{
        name: string
        description: string
        invocable?: boolean
        invocation?: 'filesystem'
        resource?: AgentSkillResource
      }> } | null) => {
        if (aborted || !payload?.skills) return
        let added = 0
        for (const skill of payload.skills) {
          if (skill.invocable === false) continue
          if (!registry.get(skill.name)) {
            const resource = skill.resource
            const command: SlashCommand = {
              name: skill.name,
              description: skill.description,
              kind: 'skill',
              source: 'skill',
              skillExpansion: skill.invocation === 'filesystem' && resource
                ? async (args) => {
                    const query = new URLSearchParams({
                      filesystem: resource.filesystem,
                      path: resource.path,
                    })
                    const response = await nextFetch(
                      agentResourceUrl(apiBaseUrl, `/api/v1/files?${query.toString()}`),
                      { headers: scopedHeaders(currentHeaders, storageScope) },
                    )
                    if (!response.ok) throw new Error('Skill is no longer available.')
                    const result = await response.json() as { content?: unknown }
                    if (typeof result.content !== 'string') throw new Error('Skill could not be loaded.')
                    return filesystemSkillText(skill.name, resource, result.content, args)
                  }
                : undefined,
              handler: () => {},
            }
            registry.register(command)
            ownedCommands.push(command)
            added++
          }
        }
        if (added > 0 || refreshKey) setSkillsStamp((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      aborted = true
      let removed = false
      for (const command of ownedCommands) {
        if (registry.get(command.name) === command) {
          registry.unregister(command.name)
          removed = true
        }
      }
      if (removed) setSkillsStamp((n) => n + 1)
    }
  }, [apiBaseUrl, enabled, fetchImpl, refreshKey, registry, requestHeadersJson, storageScope])

  return skillsStamp
}

function filesystemSkillText(
  name: string,
  resource: AgentSkillResource,
  content: string,
  args: string,
): string {
  const request = args.trim()
  const skillRoot = resource.path.slice(0, -'/SKILL.md'.length)
  return [
    `skill: ${name}`,
    'Follow the freshly authorized skill instructions below.',
    `Authorized source: ${JSON.stringify(resource)}`,
    `Resolve relative references against ${skillRoot} in the ${resource.filesystem} filesystem.`,
    '--- BEGIN SKILL INSTRUCTIONS ---',
    content,
    '--- END SKILL INSTRUCTIONS ---',
    ...(request ? ['User request:', request] : []),
  ].join('\n')
}

function agentResourceUrl(apiBaseUrl: string | undefined, path: string): string {
  const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
  return `${base}${path}`
}

function scopedHeaders(headers: Record<string, string> | undefined, storageScope: string | undefined): Record<string, string> | undefined {
  if (!headers && !storageScope) return undefined
  const result: Record<string, string> = { ...(headers ?? {}) }
  const hasStorageScope = Object.keys(result).some((key) => key.toLowerCase() === 'x-boring-storage-scope')
  if (storageScope && !hasStorageScope) result['x-boring-storage-scope'] = storageScope
  return result
}
