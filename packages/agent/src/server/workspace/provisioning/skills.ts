import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BoringAgentRuntimePaths } from '@hachej/boring-sandbox/providers/node-workspace'
import type { ProvisionWorkspaceRuntimeOptions, WorkspaceProvisioningAdapter } from './types'

const GENERATED_SKILLS_REL = '.boring-agent/skills'
const USER_SKILLS_REL = '.agents/skills'

export interface MirrorPluginSkillsResult {
  changed: boolean
  skillPaths: string[]
}

function sourceToPath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source
}

function assertSafeSegment(kind: string, value: string): void {
  if (
    value.length === 0
    || value.includes('\0')
    || value.includes('/')
    || value.includes('\\')
    || value === '.'
    || value === '..'
  ) {
    throw new Error(`Invalid ${kind} for plugin skill mirror: ${value}`)
  }
}

export function getProvisionedSkillPaths(paths: BoringAgentRuntimePaths): string[] {
  return [paths.skills, join(paths.workspaceRoot, USER_SKILLS_REL)]
}

export async function mirrorPluginSkills(options: {
  plugins: ProvisionWorkspaceRuntimeOptions['plugins']
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
}): Promise<MirrorPluginSkillsResult> {
  await options.adapter.workspaceFs.rm(GENERATED_SKILLS_REL)
  await options.adapter.workspaceFs.mkdir(GENERATED_SKILLS_REL)

  const seen = new Set<string>()
  let copiedSkillCount = 0

  for (const plugin of options.plugins) {
    assertSafeSegment('plugin id', plugin.id)

    for (const skill of plugin.skills ?? []) {
      assertSafeSegment('skill name', skill.name)
      const key = `${plugin.id}/${skill.name}`
      if (seen.has(key)) {
        throw new Error(`Duplicate plugin skill mirror target: ${key}`)
      }
      seen.add(key)

      const sourcePath = sourceToPath(skill.source)
      const sourceStat = await stat(sourcePath)
      const skillTarget = `${GENERATED_SKILLS_REL}/${plugin.id}/${skill.name}`
      const target = sourceStat.isDirectory()
        ? skillTarget
        : `${skillTarget}/SKILL.md`

      await options.adapter.workspaceFs.copyFromHost(skill.source, target)
      copiedSkillCount += 1
    }
  }

  return {
    changed: copiedSkillCount > 0,
    skillPaths: getProvisionedSkillPaths(options.runtimeLayout),
  }
}
