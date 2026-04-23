import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import packageJson from '../../../package.json'
import {
  CLI_VERSION,
  decideBrowserOpen,
  deletePersistedKey,
  ensureGitignoreEntries,
  parsePersistedEnv,
  persistApiKey,
  resolveCliConfig,
  runCli,
  selectPort,
} from '../boring-agent'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function captureStdout(run: () => Promise<unknown>): Promise<string> {
  const writes: string[] = []
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown) => {
      writes.push(
        typeof chunk === 'string'
          ? chunk
          : Buffer.from(chunk as Uint8Array).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write)

  try {
    await run()
    return writes.join('')
  } finally {
    spy.mockRestore()
  }
}

describe('CLI_VERSION', () => {
  test('matches package.json version', () => {
    expect(CLI_VERSION).toBe(packageJson.version)
  })
})

describe('parsePersistedEnv', () => {
  test('parses KEY=VALUE lines and skips comments', () => {
    const raw = [
      '# Added by boring-agent',
      '',
      'ANTHROPIC_API_KEY=sk-ant-test',
      'FOO=bar',
      '  # trailing comment line',
    ].join('\n')

    const parsed = parsePersistedEnv(raw)
    expect(parsed.ANTHROPIC_API_KEY).toBe('sk-ant-test')
    expect(parsed.FOO).toBe('bar')
  })
})

describe('persistApiKey / deletePersistedKey', () => {
  test('writes secure modes and can delete the env file', async () => {
    const root = await makeTempDir('boring-agent-cli-key-')
    const envPath = path.join(root, '.config', 'boring-agent', 'env')

    await persistApiKey(envPath, 'sk-ant-secret')

    const envBody = await readFile(envPath, 'utf8')
    expect(parsePersistedEnv(envBody).ANTHROPIC_API_KEY).toBe('sk-ant-secret')

    const envFileStat = await stat(envPath)
    expect(envFileStat.mode & 0o777).toBe(0o600)

    const envDirStat = await stat(path.dirname(envPath))
    expect(envDirStat.mode & 0o777).toBe(0o700)

    await deletePersistedKey(envPath)
    await expect(readFile(envPath, 'utf8')).rejects.toThrow()
  })
})

describe('ensureGitignoreEntries', () => {
  test('appends missing .boring-agent/ and .pi/ entries for git repos', async () => {
    const root = await makeTempDir('boring-agent-cli-gitignore-')
    await mkdir(path.join(root, '.git'))
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n.pi/\n')

    const changed = await ensureGitignoreEntries(root)
    expect(changed).toBe(true)

    const firstPass = await readFile(path.join(root, '.gitignore'), 'utf8')
    expect(firstPass).toContain('.pi/')
    expect(firstPass).toContain('.boring-agent/')

    const changedAgain = await ensureGitignoreEntries(root)
    expect(changedAgain).toBe(false)

    const secondPass = await readFile(path.join(root, '.gitignore'), 'utf8')
    expect((secondPass.match(/\.boring-agent\//gu) ?? []).length).toBe(1)
    expect((secondPass.match(/\.pi\//gu) ?? []).length).toBe(1)
  })

  test('no-ops outside git repos', async () => {
    const root = await makeTempDir('boring-agent-cli-nonrepo-')
    const changed = await ensureGitignoreEntries(root)
    expect(changed).toBe(false)
  })
})

describe('decideBrowserOpen', () => {
  test('skips on explicit --no-open flag', () => {
    const decision = decideBrowserOpen({
      noOpen: true,
      env: {},
      platform: 'linux',
    })
    expect(decision).toEqual({ open: false, reason: 'no-open' })
  })

  test('skips in SSH sessions', () => {
    const decision = decideBrowserOpen({
      noOpen: false,
      env: { SSH_CONNECTION: 'x' },
      platform: 'linux',
    })
    expect(decision).toEqual({ open: false, reason: 'ssh' })
  })

  test('skips in CI', () => {
    const decision = decideBrowserOpen({
      noOpen: false,
      env: { CI: 'true' },
      platform: 'linux',
    })
    expect(decision).toEqual({ open: false, reason: 'ci' })
  })

  test('skips for non-empty CI values commonly used in hosted CI', () => {
    const decision = decideBrowserOpen({
      noOpen: false,
      env: { CI: 'github-actions' },
      platform: 'linux',
    })
    expect(decision).toEqual({ open: false, reason: 'ci' })
  })

  test('skips headless linux', () => {
    const decision = decideBrowserOpen({
      noOpen: false,
      env: {},
      platform: 'linux',
    })
    expect(decision).toEqual({ open: false, reason: 'headless-linux' })
  })

  test('opens when not in skip conditions', () => {
    const decision = decideBrowserOpen({
      noOpen: false,
      env: { DISPLAY: ':0' },
      platform: 'linux',
    })
    expect(decision).toEqual({ open: true })
  })
})

describe('selectPort', () => {
  test('reuses an existing boring-agent server when health version matches', async () => {
    const portsChecked: number[] = []

    const selection = await selectPort({
      startPort: 8787,
      expectedVersion: '@boring/agent@test',
      probeHealthFn: async (port) => {
        portsChecked.push(port)
        return 'ours'
      },
      isPortFreeFn: async () => {
        throw new Error('isPortFreeFn should not be called when health is ours')
      },
    })

    expect(selection).toEqual({
      port: 8787,
      attempts: 1,
      reuseExisting: true,
    })
    expect(portsChecked).toEqual([8787])
  })

  test('skips busy ports and selects the next free candidate', async () => {
    const selection = await selectPort({
      startPort: 9000,
      expectedVersion: '@boring/agent@test',
      probeHealthFn: async (port) => (port === 9000 ? 'other' : 'unreachable'),
      isPortFreeFn: async (port) => port === 9001,
    })

    expect(selection).toEqual({
      port: 9001,
      attempts: 2,
      reuseExisting: false,
    })
  })
})

describe('resolveCliConfig', () => {
  test('rejects ports above 65535', async () => {
    await expect(
      resolveCliConfig(['--port', '70000'], {} as NodeJS.ProcessEnv),
    ).rejects.toThrow('between 1 and 65535')
  })
})

describe('runCli', () => {
  test('--version prints exact package version', async () => {
    const output = await captureStdout(async () => {
      await runCli({ argv: ['--version'], env: {} })
    })
    expect(output.trim()).toBe(CLI_VERSION)
  })

  test('--logout removes persisted key at configured env path', async () => {
    const root = await makeTempDir('boring-agent-cli-logout-')
    const envPath = path.join(root, 'env')
    await persistApiKey(envPath, 'sk-ant-secret')

    await captureStdout(async () => {
      await runCli({ argv: ['--logout'], env: {}, envPath })
    })

    await expect(readFile(envPath, 'utf8')).rejects.toThrow()
  })
})
