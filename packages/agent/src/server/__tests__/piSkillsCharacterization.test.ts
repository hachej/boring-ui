import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSkills } from '@mariozechner/pi-coding-agent'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boring-pi-skills-characterization-'))
  roots.push(root)
  return root
}

async function writeSkill(root: string, directory: string, name: string, description: string): Promise<string> {
  const skillDir = join(root, directory)
  const filePath = join(skillDir, 'SKILL.md')
  await mkdir(skillDir, { recursive: true })
  await writeFile(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, 'utf8')
  return filePath
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pinned Pi 0.80.7 skill discovery characterization', () => {
  test('keeps the characterized implementation pinned in the Agent manifest', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> }

    expect(packageJson.dependencies?.['@mariozechner/pi-coding-agent']).toBe(
      'npm:@earendil-works/pi-coding-agent@0.80.7',
    )
  })

  test('preserves explicit root order, source metadata, and the first same-name winner', async () => {
    const root = await makeRoot()
    const cwd = join(root, 'workspace')
    const agentDir = join(root, 'agent-dir')
    const workspaceSkills = join(cwd, '.agents', 'skills')
    const packageSkills = join(root, 'package', 'skills')
    const sharedSkills = join(agentDir, 'extensions', 'shared', 'skills')
    const workspaceFile = await writeSkill(workspaceSkills, 'same-name', 'same-name', 'Workspace winner.')
    const packageFile = await writeSkill(packageSkills, 'same-name', 'same-name', 'Package loser.')
    const sharedFile = await writeSkill(sharedSkills, 'same-name', 'same-name', 'Shared loser.')

    const result = loadSkills({
      cwd,
      agentDir,
      skillPaths: [workspaceSkills, packageSkills, sharedSkills],
      includeDefaults: false,
    })

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      name: 'same-name',
      description: 'Workspace winner.',
      filePath: workspaceFile,
      baseDir: join(workspaceSkills, 'same-name'),
      sourceInfo: {
        source: 'local',
        path: workspaceFile,
        baseDir: join(workspaceSkills, 'same-name'),
      },
    })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        type: 'collision',
        path: packageFile,
        collision: expect.objectContaining({ winnerPath: workspaceFile, loserPath: packageFile }),
      }),
      expect.objectContaining({
        type: 'collision',
        path: sharedFile,
        collision: expect.objectContaining({ winnerPath: workspaceFile, loserPath: sharedFile }),
      }),
    ])
  })

  test('treats a skill directory and its direct SKILL.md path equivalently', async () => {
    const root = await makeRoot()
    const cwd = join(root, 'workspace')
    const agentDir = join(root, 'agent-dir')
    const skillRoot = join(root, 'package', 'skills', 'direct-form')
    const skillFile = await writeSkill(join(root, 'package', 'skills'), 'direct-form', 'direct-form', 'Direct form.')

    const fromDirectory = loadSkills({ cwd, agentDir, skillPaths: [skillRoot], includeDefaults: false })
    const fromFile = loadSkills({ cwd, agentDir, skillPaths: [skillFile], includeDefaults: false })

    expect(fromDirectory).toEqual(fromFile)
    expect(fromDirectory.skills[0]).toMatchObject({
      filePath: skillFile,
      baseDir: skillRoot,
      sourceInfo: { source: 'local', path: skillFile, baseDir: skillRoot },
    })
  })

  test('loads ambient user skills before project skills and reports their scopes', async () => {
    const root = await makeRoot()
    const cwd = join(root, 'workspace')
    const agentDir = join(root, 'agent-dir')
    const userFile = await writeSkill(join(agentDir, 'skills'), 'ambient-name', 'ambient-name', 'Ambient user winner.')
    const projectFile = await writeSkill(join(cwd, '.pi', 'skills'), 'ambient-name', 'ambient-name', 'Ambient project loser.')

    const result = loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true })

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      filePath: userFile,
      sourceInfo: { source: 'local', scope: 'user', path: userFile },
    })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        type: 'collision',
        path: projectFile,
        collision: expect.objectContaining({ winnerPath: userFile, loserPath: projectFile }),
      }),
    ])
  })
})
