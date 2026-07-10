import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BoringAgentRuntimePaths } from '../runtimeLayout'
import type { PluginSkillAccess, ProvisionWorkspaceRuntimeOptions, WorkspaceProvisioningAdapter } from './types'

const GENERATED_SKILLS_REL = '.boring-agent/skills'
const REQUEST_SKILLS_REL = '.boring-agent/skills-requests'
const USER_SKILLS_REL = '.agents/skills'

export interface MirrorPluginSkillsResult {
  changed: boolean
  skillPaths: string[]
  excludedSkillFilePaths?: string[]
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

const PLUGIN_SKILL_ACCESSES = ['invisible', 'readonly', 'readwrite'] as const satisfies readonly PluginSkillAccess[]

function assertSkillAccess(value: string): asserts value is PluginSkillAccess {
  if (!PLUGIN_SKILL_ACCESSES.includes(value as PluginSkillAccess)) {
    throw new Error(`Invalid skill access for plugin skill mirror: ${value}`)
  }
}

function requestScopeId(context: ProvisionWorkspaceRuntimeOptions['skillAccessContext']): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify({
    userId: context?.userId ?? null,
    userEmail: context?.userEmail ?? null,
    userEmailVerified: context?.userEmailVerified === true,
  }))
  return hash.digest('hex').slice(0, 24)
}

export function getProvisionedSkillPaths(
  paths: BoringAgentRuntimePaths,
  context?: ProvisionWorkspaceRuntimeOptions['skillAccessContext'],
): string[] {
  if (!context) return [paths.skills, join(paths.workspaceRoot, USER_SKILLS_REL)]
  return []
}

export async function mirrorPluginSkills(options: {
  plugins: ProvisionWorkspaceRuntimeOptions['plugins']
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  skillAccessContext?: ProvisionWorkspaceRuntimeOptions['skillAccessContext']
  resolvePluginSkillAccess?: ProvisionWorkspaceRuntimeOptions['resolvePluginSkillAccess']
}): Promise<MirrorPluginSkillsResult> {
  const generatedSkillsRel = GENERATED_SKILLS_REL
  const writableSkillsRel = USER_SKILLS_REL

  if (!options.skillAccessContext) {
    await options.adapter.workspaceFs.rm(generatedSkillsRel)
    await options.adapter.workspaceFs.mkdir(generatedSkillsRel)
  }

  const seen = new Set<string>()
  let copiedSkillCount = 0
  const excludedSkillFilePaths: string[] = []
  const requestScopedSkillPaths: string[] = []
  const requestSkillsRel = options.skillAccessContext
    ? `${REQUEST_SKILLS_REL}/${requestScopeId(options.skillAccessContext)}`
    : undefined
  let requestScopePrepared = false
  const prepareRequestScope = async () => {
    if (!requestSkillsRel || requestScopePrepared) return
    await options.adapter.workspaceFs.rm(requestSkillsRel)
    await options.adapter.workspaceFs.mkdir(requestSkillsRel)
    requestScopePrepared = true
  }

  for (const plugin of options.plugins) {
    assertSafeSegment('plugin id', plugin.id)

    for (const skill of plugin.skills ?? []) {
      assertSafeSegment('skill name', skill.name)
      if (options.skillAccessContext) {
        excludedSkillFilePaths.push(`${USER_SKILLS_REL}/${plugin.id}/${skill.name}/SKILL.md`)
      }
      const defaultAccess = skill.access ?? 'readonly'
      assertSkillAccess(defaultAccess)
      const access = options.resolvePluginSkillAccess
        ? await options.resolvePluginSkillAccess({
            ...(options.skillAccessContext ?? {}),
            pluginId: plugin.id,
            skillName: skill.name,
            defaultAccess,
          }) ?? defaultAccess
        : defaultAccess
      assertSkillAccess(access)
      if (access === 'invisible') continue

      const key = `${plugin.id}/${skill.name}`
      if (seen.has(key)) {
        throw new Error(`Duplicate plugin skill mirror target: ${key}`)
      }
      seen.add(key)

      const sourcePath = sourceToPath(skill.source)
      const sourceStat = await stat(sourcePath)
      if (options.skillAccessContext) {
        await prepareRequestScope()
        const skillTarget = `${requestSkillsRel}/${plugin.id}/${skill.name}`
        const target = sourceStat.isDirectory()
          ? skillTarget
          : `${skillTarget}/SKILL.md`
        await options.adapter.workspaceFs.copyFromHost(skill.source, target)
        requestScopedSkillPaths.push(join(options.runtimeLayout.workspaceRoot, skillTarget))
        copiedSkillCount += 1
        continue
      }

      // Request-scoped access (governance/RBAC) must not materialize editable
      // files into the shared workspace: a hashed path under .agents/ would
      // still be visible to every user with workspace filesystem access. Until
      // there is a real per-user filesystem boundary, governed readwrite means
      // "available for this user" and is mirrored into the user's generated
      // skill set. Self-contained plugin defaults without a request context keep
      // the historical readwrite behavior and seed .agents/skills once.
      const materializeReadwrite = access === 'readwrite' && !options.skillAccessContext
      const skillTarget = materializeReadwrite
        ? `${writableSkillsRel}/${plugin.id}/${skill.name}`
        : `${generatedSkillsRel}/${plugin.id}/${skill.name}`
      const target = sourceStat.isDirectory()
        ? skillTarget
        : `${skillTarget}/SKILL.md`

      if (materializeReadwrite) {
        await options.adapter.workspaceFs.mkdir(`${writableSkillsRel}/${plugin.id}`)
        if (await options.adapter.workspaceFs.exists(skillTarget)) continue
      }

      await options.adapter.workspaceFs.copyFromHost(skill.source, target)
      copiedSkillCount += 1
    }
  }

  return {
    changed: copiedSkillCount > 0,
    skillPaths: options.skillAccessContext
      ? requestScopedSkillPaths
      : getProvisionedSkillPaths(options.runtimeLayout, options.skillAccessContext),
    ...(excludedSkillFilePaths.length > 0 ? { excludedSkillFilePaths } : {}),
  }
}
