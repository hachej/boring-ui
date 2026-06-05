import { useEffect, useState } from 'react'
import type { CommandRegistry } from '../slashCommands/registry'

interface ServerSkill {
  name: string
  description: string
}

function skillFingerprint(skills: ServerSkill[]): string {
  return skills
    .map((skill) => `${skill.name}\u0000${skill.description}`)
    .sort()
    .join('\u0001')
}

export function useServerSkills({
  registry,
  requestHeaders,
  enabled = true,
}: {
  registry: CommandRegistry
  requestHeaders?: Record<string, string>
  enabled?: boolean
}): string {
  // Bumped when server skills change so the picker re-renders even when the
  // same command name already existed in the registry from a previous render.
  const [skillsStamp, setSkillsStamp] = useState('')

  // Fetch PI skills and register them so the slash picker shows them without
  // host apps needing to hardcode them in extraCommands. Server skills never
  // overwrite builtins or host-provided extraCommands (first-write wins).
  useEffect(() => {
    if (!enabled) return
    let aborted = false
    fetch('/api/v1/agent/skills', { headers: requestHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { skills?: ServerSkill[] } | null) => {
        if (aborted || !payload?.skills) return
        for (const skill of payload.skills) {
          if (!registry.get(skill.name)) {
            registry.register({ name: skill.name, description: skill.description, kind: 'skill', handler: () => {} })
          }
        }
        setSkillsStamp(skillFingerprint(payload.skills))
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [enabled, requestHeaders, registry])

  return skillsStamp
}
