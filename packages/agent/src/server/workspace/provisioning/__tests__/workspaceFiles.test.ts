import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'vitest'

import { seedWorkspaceFiles } from '../workspaceFiles'
import type { WorkspaceProvisioningAdapter } from '../types'

interface FakeWorkspaceFsState {
  files: Map<string, string>
  dirs: Set<string>
  copied: Array<{ source: string | URL; target: string }>
  mkdirs: string[]
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
      async rm() {
        throw new Error('workspace file seeding must never delete user files')
      },
      async mkdir(path) {
        const safePath = assertSafeRel(path)
        state.dirs.add(safePath)
        state.mkdirs.push(safePath)
      },
      async writeText(path, content) {
        state.files.set(assertSafeRel(path), content)
      },
      async readText(path) {
        return state.files.get(assertSafeRel(path)) ?? null
      },
      async copyFromHost(source, target) {
        const sourcePath = source instanceof URL ? source.pathname : source
        const safeTarget = assertSafeRel(target)
        const sourceStat = await stat(sourcePath)
        state.copied.push({ source, target: safeTarget })
        if (sourceStat.isDirectory()) {
          state.dirs.add(safeTarget)
          const entries = await readdir(sourcePath, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isFile()) {
              const childPath = join(sourcePath, entry.name)
              state.files.set(`${safeTarget}/${entry.name}`, await readFile(childPath, 'utf8'))
            }
          }
          return
        }
        state.files.set(safeTarget, await readFile(sourcePath, 'utf8'))
      },
    },
    getRuntimeCacheRoot() { return '/workspace/.boring-agent/cache' },
  }
}

async function makeTemplateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boring-template-'))
  await mkdir(join(root, 'deck'), { recursive: true })
  await mkdir(join(root, 'transforms', 'custom'), { recursive: true })
  await mkdir(join(root, 'empty-dir'), { recursive: true })
  await writeFile(join(root, 'deck', 'intro.md'), '# Intro\n')
  await writeFile(join(root, 'transforms', 'custom', '.gitkeep'), '')
  return root
}

test('seeds missing template files and nested directories without overwrite', async () => {
  const templateRoot = await makeTemplateRoot()
  const state: FakeWorkspaceFsState = {
    files: new Map([['deck/intro.md', '# User edited intro\n']]),
    dirs: new Set(),
    copied: [],
    mkdirs: [],
  }

  const result = await seedWorkspaceFiles({
    plugins: [{
      id: 'boring-macro',
      provisioning: { templateDirs: [{ id: 'macro-template', path: templateRoot }] },
    }],
    adapter: createFakeAdapter(state),
  })

  expect(result.changed).toBe(true)
  expect(state.files.get('deck/intro.md')).toBe('# User edited intro\n')
  expect(state.files.get('transforms/custom/.gitkeep')).toBe('')
  expect(state.dirs.has('empty-dir')).toBe(true)
  expect(state.copied.map((copy) => copy.target)).not.toContain('deck/intro.md')
})

test('supports target prefixes for template directories', async () => {
  const templateRoot = await makeTemplateRoot()
  const state: FakeWorkspaceFsState = { files: new Map(), dirs: new Set(), copied: [], mkdirs: [] }

  await seedWorkspaceFiles({
    plugins: [{
      id: 'plugin',
      provisioning: { templateDirs: [{ id: 'prefixed', path: templateRoot, target: 'starter' }] },
    }],
    adapter: createFakeAdapter(state),
  })

  expect(state.files.get('starter/deck/intro.md')).toBe('# Intro\n')
  expect(state.files.has('deck/intro.md')).toBe(false)
  expect(state.dirs.has('starter/empty-dir')).toBe(true)
})

test('supports single file templates with explicit and implicit targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boring-template-file-'))
  const file = join(root, 'README.md')
  await writeFile(file, '# Read me\n')
  const state: FakeWorkspaceFsState = { files: new Map(), dirs: new Set(), copied: [], mkdirs: [] }

  await seedWorkspaceFiles({
    plugins: [{
      id: 'plugin',
      provisioning: {
        templateDirs: [
          { id: 'implicit-file', path: file },
          { id: 'explicit-file', path: file, target: 'docs/README.md' },
        ],
      },
    }],
    adapter: createFakeAdapter(state),
  })

  expect(state.files.get('README.md')).toBe('# Read me\n')
  expect(state.files.get('docs/README.md')).toBe('# Read me\n')
})

test('no-op when every target already exists', async () => {
  const templateRoot = await makeTemplateRoot()
  const state: FakeWorkspaceFsState = {
    files: new Map([
      ['deck/intro.md', '# Existing\n'],
      ['transforms/custom/.gitkeep', 'keep\n'],
    ]),
    dirs: new Set(['deck', 'transforms', 'transforms/custom', 'empty-dir']),
    copied: [],
    mkdirs: [],
  }

  await expect(seedWorkspaceFiles({
    plugins: [{ id: 'plugin', provisioning: { templateDirs: [{ id: 'template', path: templateRoot }] } }],
    adapter: createFakeAdapter(state),
  })).resolves.toEqual({ changed: false })
  expect(state.copied).toEqual([])
  expect(state.mkdirs).toEqual([])
})

test('unsafe targets are rejected by adapter validation with template context', async () => {
  const templateRoot = await makeTemplateRoot()

  await expect(seedWorkspaceFiles({
    plugins: [{
      id: 'plugin',
      provisioning: { templateDirs: [{ id: 'unsafe-template', path: templateRoot, target: '../escape' }] },
    }],
    adapter: createFakeAdapter({ files: new Map(), dirs: new Set(), copied: [], mkdirs: [] }),
  })).rejects.toThrow('plugin=plugin, template=unsafe-template')
})

test('does not delete user workspace files', async () => {
  const templateRoot = await makeTemplateRoot()
  const state: FakeWorkspaceFsState = {
    files: new Map([['unrelated/user.txt', 'do not touch\n']]),
    dirs: new Set(),
    copied: [],
    mkdirs: [],
  }

  await seedWorkspaceFiles({
    plugins: [{ id: 'plugin', provisioning: { templateDirs: [{ id: 'template', path: templateRoot }] } }],
    adapter: createFakeAdapter(state),
  })

  expect(state.files.get('unrelated/user.txt')).toBe('do not touch\n')
})
