import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { getBoringAgentRuntimePaths } from '../../runtimeLayout'
import { mirrorPluginSkills } from '../skills'
import type { WorkspaceProvisioningAdapter } from '../types'

interface FakeWorkspaceFsState {
  files: Map<string, string>
  dirs: Set<string>
  removed: string[]
  copied: Array<{ source: string | URL; target: string }>
}

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/')
}

function assertSafeRel(path: string): string {
  const normalized = normalizeRel(path)
  if (
    normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.split('/').some((part) => part === '..')
  ) {
    throw new Error(`unsafe workspace path in fake adapter: ${path}`)
  }
  return normalized
}

function createFakeAdapter(state: FakeWorkspaceFsState): WorkspaceProvisioningAdapter {
  async function copySource(source: string | URL, target: string): Promise<void> {
    const sourcePath = source instanceof URL ? source.pathname : source
    const sourceStat = await stat(sourcePath)
    const safeTarget = assertSafeRel(target)

    state.copied.push({ source, target: safeTarget })

    if (sourceStat.isDirectory()) {
      state.dirs.add(safeTarget)
      const entries = await readdir(sourcePath, { withFileTypes: true })
      for (const entry of entries) {
        await copySource(join(sourcePath, entry.name), `${safeTarget}/${entry.name}`)
      }
      return
    }

    state.files.set(safeTarget, await readFile(sourcePath, 'utf8'))
  }

  return {
    mode: 'direct',
    async exec() {},
    async resolveInstallSource(source) { return String(source) },
    workspaceFs: {
      async exists(path) {
        const safePath = assertSafeRel(path)
        return state.files.has(safePath)
          || state.dirs.has(safePath)
          || [...state.files.keys()].some((key) => key.startsWith(`${safePath}/`))
          || [...state.dirs.keys()].some((key) => key.startsWith(`${safePath}/`))
      },
      async rm(path) {
        const safePath = assertSafeRel(path)
        state.removed.push(safePath)
        for (const key of [...state.files.keys()]) {
          if (key === safePath || key.startsWith(`${safePath}/`)) state.files.delete(key)
        }
        for (const key of [...state.dirs]) {
          if (key === safePath || key.startsWith(`${safePath}/`)) state.dirs.delete(key)
        }
      },
      async mkdir(path) {
        state.dirs.add(assertSafeRel(path))
      },
      async writeText(path, content) {
        state.files.set(assertSafeRel(path), content)
      },
      async readText(path) {
        return state.files.get(assertSafeRel(path)) ?? null
      },
      copyFromHost: copySource,
    },
    getRuntimeCacheRoot() { return '/workspace/.boring-agent/cache' },
  }
}

async function writeHostFile(root: string, rel: string, content: string): Promise<string> {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  return path
}

async function createHostDirSkill(root: string): Promise<string> {
  const dir = join(root, 'macro-deck')
  await mkdir(join(dir, 'examples'), { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '# Macro deck\n')
  await writeFile(join(dir, 'examples', 'demo.md'), 'demo\n')
  return dir
}

test('mirrors file and directory plugin skills into generated .boring-agent/skills paths', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-host-'))
  const fileSkill = await writeHostFile(host, 'macro-transform.md', '# Macro transform\n')
  const dirSkill = await createHostDirSkill(host)
  const state: FakeWorkspaceFsState = {
    files: new Map(),
    dirs: new Set(),
    removed: [],
    copied: [],
  }
  const runtimeLayout = getBoringAgentRuntimePaths('/workspace')

  const result = await mirrorPluginSkills({
    plugins: [{
      id: 'boring-macro',
      skills: [
        { name: 'macro-transform', source: fileSkill },
        { name: 'macro-deck', source: new URL(`file://${dirSkill}/`) },
      ],
    }],
    adapter: createFakeAdapter(state),
    runtimeLayout,
  })

  expect(result.changed).toBe(true)
  expect(state.removed).toEqual(['.boring-agent/skills'])
  expect(state.files.get('.boring-agent/skills/boring-macro/macro-transform/SKILL.md')).toBe('# Macro transform\n')
  expect(state.files.get('.boring-agent/skills/boring-macro/macro-deck/SKILL.md')).toBe('# Macro deck\n')
  expect(state.files.get('.boring-agent/skills/boring-macro/macro-deck/examples/demo.md')).toBe('demo\n')
  expect(result.skillPaths).toEqual([
    '/workspace/.boring-agent/skills',
    '/workspace/.agents/skills',
  ])
})

test('skill access controls plugin skill visibility and editability', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-access-'))
  const readonlySkill = await writeHostFile(host, 'readonly.md', '# Readonly\n')
  const readwriteSkill = await writeHostFile(host, 'readwrite.md', '# Readwrite\n')
  const invisibleSkill = await writeHostFile(host, 'invisible.md', '# Invisible\n')
  const state: FakeWorkspaceFsState = {
    files: new Map(),
    dirs: new Set(),
    removed: [],
    copied: [],
  }

  await mirrorPluginSkills({
    plugins: [{
      id: 'clinic',
      skills: [
        { name: 'readonly-skill', source: readonlySkill, access: 'readonly' },
        { name: 'editable-skill', source: readwriteSkill, access: 'readwrite' },
        { name: 'hidden-skill', source: invisibleSkill, access: 'invisible' },
      ],
    }],
    adapter: createFakeAdapter(state),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })

  expect(state.files.get('.boring-agent/skills/clinic/readonly-skill/SKILL.md')).toBe('# Readonly\n')
  expect(state.files.get('.agents/skills/clinic/editable-skill/SKILL.md')).toBe('# Readwrite\n')
  expect([...state.files.keys()].some((path) => path.includes('hidden-skill'))).toBe(false)
})

test('request-scoped skill access mirrors into per-user generated paths', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-user-access-'))
  const readonlySkill = await writeHostFile(host, 'readonly.md', '# Readonly\n')
  const readwriteSkill = await writeHostFile(host, 'readwrite.md', '# Readwrite\n')
  const hiddenSkill = await writeHostFile(host, 'hidden.md', '# Hidden\n')
  const state: FakeWorkspaceFsState = {
    files: new Map(),
    dirs: new Set(),
    removed: [],
    copied: [],
  }

  const result = await mirrorPluginSkills({
    plugins: [{
      id: 'clinic',
      skills: [
        { name: 'readonly', source: readonlySkill, access: 'invisible' },
        { name: 'editable', source: readwriteSkill, access: 'readonly' },
        { name: 'hidden', source: hiddenSkill, access: 'readonly' },
      ],
    }],
    adapter: createFakeAdapter(state),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
    skillAccessContext: { userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true },
    resolvePluginSkillAccess: ({ skillName }) => {
      if (skillName === 'readonly') return 'readonly'
      if (skillName === 'editable') return 'readwrite'
      return 'invisible'
    },
  })

  const readonlyPath = [...state.files.keys()].find((path) => path.endsWith('/clinic/readonly/SKILL.md'))
  const editablePath = [...state.files.keys()].find((path) => path.endsWith('/clinic/editable/SKILL.md'))
  expect(readonlyPath).toMatch(/^\.boring-agent\/skills-users\/[a-f0-9]{24}\/clinic\/readonly\/SKILL\.md$/)
  expect(editablePath).toMatch(/^\.boring-agent\/skills-users\/[a-f0-9]{24}\/clinic\/editable\/SKILL\.md$/)
  expect([...state.files.keys()].some((path) => path.includes('/hidden/'))).toBe(false)
  expect(result.skillPaths).toHaveLength(1)
  expect(result.skillPaths[0]).toContain('/.boring-agent/skills-users/')
  expect(result.skillPaths.some((path) => path.includes('/.agents/'))).toBe(false)
})

test('verified and unverified access use distinct generated skill paths for the same user', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-verification-access-'))
  const skill = await writeHostFile(host, 'verified.md', '# Verified only\n')
  const state: FakeWorkspaceFsState = {
    files: new Map(),
    dirs: new Set(),
    removed: [],
    copied: [],
  }
  const baseContext = { userId: 'user-1', userEmail: 'user@example.com' }
  const options = {
    plugins: [{ id: 'clinic', skills: [{ name: 'verified-only', source: skill, access: 'readonly' as const }] }],
    adapter: createFakeAdapter(state),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  }

  const unverified = await mirrorPluginSkills({
    ...options,
    skillAccessContext: { ...baseContext, userEmailVerified: false },
    resolvePluginSkillAccess: () => 'invisible',
  })
  const verified = await mirrorPluginSkills({
    ...options,
    skillAccessContext: { ...baseContext, userEmailVerified: true },
    resolvePluginSkillAccess: () => 'readonly',
  })

  expect(unverified.skillPaths[0]).not.toBe(verified.skillPaths[0])
  const unverifiedNamespace = unverified.skillPaths[0]?.split('/').at(-1)
  const verifiedNamespace = verified.skillPaths[0]?.split('/').at(-1)
  expect(state.files.has(`.boring-agent/skills-users/${unverifiedNamespace}/clinic/verified-only/SKILL.md`)).toBe(false)
  expect(state.files.get(`.boring-agent/skills-users/${verifiedNamespace}/clinic/verified-only/SKILL.md`)).toBe('# Verified only\n')
})

test('ungoverned readwrite plugin skills seed once, preserve workspace edits, and keep ordinary skill paths', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-readwrite-preserve-'))
  const skill = await writeHostFile(host, 'skill.md', '# Plugin default\n')
  const state: FakeWorkspaceFsState = {
    files: new Map([
      ['.agents/skills/clinic/editable/SKILL.md', '# User edit\n'],
    ]),
    dirs: new Set(['.agents/skills', '.agents/skills/clinic']),
    removed: [],
    copied: [],
  }

  await mirrorPluginSkills({
    plugins: [{ id: 'clinic', skills: [{ name: 'editable', source: skill, access: 'readwrite' }] }],
    adapter: createFakeAdapter(state),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })

  expect(state.files.get('.agents/skills/clinic/editable/SKILL.md')).toBe('# User edit\n')
  expect(state.copied).toEqual([])
})

test('nuke-and-pave prunes removed or renamed generated skills but leaves user .agents/skills untouched', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-prune-'))
  const currentSkill = await writeHostFile(host, 'current.md', '# Current\n')
  const state: FakeWorkspaceFsState = {
    files: new Map([
      ['.boring-agent/skills/boring-macro/old-skill/SKILL.md', '# Old\n'],
      ['.agents/skills/user-skill/SKILL.md', '# User\n'],
    ]),
    dirs: new Set(['.boring-agent/skills']),
    removed: [],
    copied: [],
  }

  await mirrorPluginSkills({
    plugins: [{ id: 'boring-macro', skills: [{ name: 'current-skill', source: currentSkill }] }],
    adapter: createFakeAdapter(state),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })

  expect(state.files.has('.boring-agent/skills/boring-macro/old-skill/SKILL.md')).toBe(false)
  expect(state.files.get('.agents/skills/user-skill/SKILL.md')).toBe('# User\n')
  expect(state.files.get('.boring-agent/skills/boring-macro/current-skill/SKILL.md')).toBe('# Current\n')
})

test('missing generated skill directory is success', async () => {
  const state: FakeWorkspaceFsState = {
    files: new Map(),
    dirs: new Set(),
    removed: [],
    copied: [],
  }

  await expect(mirrorPluginSkills({
    plugins: [],
    adapter: createFakeAdapter(state),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })).resolves.toEqual({
    changed: false,
    skillPaths: ['/workspace/.boring-agent/skills', '/workspace/.agents/skills'],
  })
  expect(state.dirs.has('.boring-agent/skills')).toBe(true)
})

test('duplicate plugin skill namespace fails before runtime is ready', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-dupe-'))
  const skill = await writeHostFile(host, 'skill.md', '# Skill\n')

  await expect(mirrorPluginSkills({
    plugins: [{
      id: 'plugin',
      skills: [
        { name: 'same', source: skill },
        { name: 'same', source: skill },
      ],
    }],
    adapter: createFakeAdapter({ files: new Map(), dirs: new Set(), removed: [], copied: [] }),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })).rejects.toThrow('Duplicate plugin skill mirror target: plugin/same')
})

test('unsafe plugin ids or skill names are rejected', async () => {
  const host = await mkdtemp(join(tmpdir(), 'boring-skill-unsafe-'))
  const skill = await writeHostFile(host, 'skill.md', '# Skill\n')

  await expect(mirrorPluginSkills({
    plugins: [{ id: '../plugin', skills: [{ name: 'safe', source: skill }] }],
    adapter: createFakeAdapter({ files: new Map(), dirs: new Set(), removed: [], copied: [] }),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })).rejects.toThrow('Invalid plugin id')

  await expect(mirrorPluginSkills({
    plugins: [{ id: 'plugin', skills: [{ name: '../skill', source: skill }] }],
    adapter: createFakeAdapter({ files: new Map(), dirs: new Set(), removed: [], copied: [] }),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })).rejects.toThrow('Invalid skill name')
})

test('source copy failure rejects and leaves runtime not-ready for caller', async () => {
  await expect(mirrorPluginSkills({
    plugins: [{ id: 'plugin', skills: [{ name: 'missing', source: '/no/such/SKILL.md' }] }],
    adapter: createFakeAdapter({ files: new Map(), dirs: new Set(), removed: [], copied: [] }),
    runtimeLayout: getBoringAgentRuntimePaths('/workspace'),
  })).rejects.toThrow()
})
