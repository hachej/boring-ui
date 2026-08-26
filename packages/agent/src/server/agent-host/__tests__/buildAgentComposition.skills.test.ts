import { describe, expect, it } from 'vitest'

import { provisionedSkillPathsForAgent } from '../buildAgentComposition'
import { locateHostWorkspaceSkill, projectRuntimeSkillPathToHost } from '../skillPathProjection'

const hostRoot = '/data/workspaces/constellation-1'
const guestRoot = '/workspace'

describe('Agent composition skill coordinates', () => {
  it('projects only guest workspace paths backed by a distinct host storage root', () => {
    expect(projectRuntimeSkillPathToHost({
      skillPath: '/workspace/.agents/skills',
      runtimeWorkspaceRoot: guestRoot,
      hostStorageRoot: hostRoot,
    })).toBe('/data/workspaces/constellation-1/.agents/skills')

    expect(projectRuntimeSkillPathToHost({
      skillPath: '/workspace/.agents/skills',
      runtimeWorkspaceRoot: guestRoot,
    })).toBeUndefined()
    expect(projectRuntimeSkillPathToHost({
      skillPath: guestRoot,
      runtimeWorkspaceRoot: guestRoot,
    })).toBeUndefined()

    for (const input of [
      { skillPath: '/app/company/skills', runtimeWorkspaceRoot: guestRoot, hostStorageRoot: hostRoot },
      { skillPath: '.agents/skills', runtimeWorkspaceRoot: guestRoot, hostStorageRoot: hostRoot },
      { skillPath: `${hostRoot}/.agents/skills`, runtimeWorkspaceRoot: hostRoot, hostStorageRoot: hostRoot },
    ]) {
      expect(projectRuntimeSkillPathToHost(input)).toBe(input.skillPath)
    }
  })

  it('projects internally host-loaded workspace skills to exposed user filesystem locators', () => {
    expect(locateHostWorkspaceSkill({
      filePath: `${hostRoot}/.agents/skills/local/SKILL.md`,
      runtimeWorkspaceRoot: guestRoot,
      hostStorageRoot: hostRoot,
    })).toEqual({ filesystem: 'user', path: '.agents/skills/local/SKILL.md' })

    expect(locateHostWorkspaceSkill({
      filePath: '/app/company/skills/company/SKILL.md',
      runtimeWorkspaceRoot: guestRoot,
      hostStorageRoot: hostRoot,
    })).toBeUndefined()
    expect(locateHostWorkspaceSkill({
      filePath: `${hostRoot}/.agents/skills/local/SKILL.md`,
      runtimeWorkspaceRoot: hostRoot,
      hostStorageRoot: hostRoot,
    })).toBeUndefined()
  })

  it('does not grant configured Agents the environment-wide generated skill root', () => {
    const provisioning = {
      changed: true,
      env: {},
      pathEntries: [],
      skillPaths: ['/workspace/.boring-agent/skills', '/workspace/.agents/skills'],
    }
    const alpha = {
      agentTypeId: 'alpha',
      definition: { label: 'Alpha', instructions: 'alpha' },
    } as const
    const legacy = { agentTypeId: 'default', legacyDefault: true } as const

    expect(provisionedSkillPathsForAgent(alpha, provisioning)).toEqual([])
    expect(provisionedSkillPathsForAgent(legacy, provisioning)).toEqual(provisioning.skillPaths)
  })
})
