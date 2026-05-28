import { useEffect, useState } from 'react'
import type { CommandRegistry } from '../slashCommands/registry'

export function useServerSkills({
  registry,
  requestHeaders,
  enabled = true,
}: {
  registry: CommandRegistry
  requestHeaders?: Record<string, string>
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
    fetch('/api/v1/agent/skills', { headers: requestHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { skills?: Array<{ name: string; description: string }> } | null) => {
        if (aborted || !payload?.skills) return
        let added = 0
        for (const skill of payload.skills) {
          if (!registry.get(skill.name)) {
            registry.register({ name: skill.name, description: skill.description, kind: 'skill', handler: () => {} })
            added++
          }
        }
        if (added > 0) setSkillsStamp((n) => n + 1)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [enabled, requestHeaders, registry])

  return skillsStamp
}
