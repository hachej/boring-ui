import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createSandboxRuntimeModeAdapter } from '@hachej/boring-agent/server'

import { createAppRegistry } from '../appRegistry'

const registries: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.close()))
})

function pendingUntilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-registry-'))
  const appsRoot = path.join(root, 'apps')
  const templateRoot = path.join(root, 'template')
  await mkdir(path.join(templateRoot, 'src'), { recursive: true })
  await writeFile(path.join(templateRoot, 'package.json'), '{"scripts":{"db:push":"true"}}\n')
  await writeFile(path.join(templateRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(path.join(templateRoot, 'src', 'index.ts'), 'export {}\n')
  const commands: string[] = []
  const commandTimeouts: Array<number | undefined> = []
  const started: string[] = []
  const runtimeModeAdapter = createSandboxRuntimeModeAdapter('direct')
  const registry = createAppRegistry({
    appsRoot,
    templateRoot,
    publicHost: 'apps.test',
    runtimeModeAdapter,
    appUrlPattern: 'https://{slug}.apps.test:{port}/',
    portStart: 6100,
    portEnd: 6105,
    isPortAvailable: async () => true,
    runCommand: async (_runtime, command, args, _signal, timeoutMs) => {
      commands.push(`${command} ${args.join(' ')}`)
      commandTimeouts.push(timeoutMs)
    },
    runApp: async (_runtime, app, signal) => {
      started.push(app.slug)
      await pendingUntilAbort(signal)
    },
  })
  registries.push(registry)
  return {
    root,
    appsRoot,
    templateRoot,
    registry,
    commands,
    commandTimeouts,
    started,
    runtimeModeAdapter,
  }
}

describe('app registry', () => {
  test('materializes through the adapter, installs, pushes the database, lists, and persists', async () => {
    const { appsRoot, registry, commands, commandTimeouts, started } = await fixture()
    await registry.init()

    const first = await registry.create('Client Portal')
    const second = await registry.create('Client Portal')

    expect(first).toMatchObject({
      slug: 'client-portal',
      title: 'Client Portal',
      acceptedPort: 6100,
      candidatePort: 6101,
    })
    expect(second).toMatchObject({ slug: 'client-portal-2', acceptedPort: 6102, candidatePort: 6103 })
    expect(registry.list().map((app) => app.slug)).toEqual(['client-portal', 'client-portal-2'])
    expect(commands).toEqual([
      'pnpm install --frozen-lockfile --config.minimum-release-age=0',
      'pnpm run db:push',
      'git init -b main',
      'git config user.name One Chat',
      'git config user.email one-chat@local.invalid',
      'git add -A',
      'git commit -m Created Client Portal',
      'pnpm install --frozen-lockfile --config.minimum-release-age=0',
      'pnpm run db:push',
      'git init -b main',
      'git config user.name One Chat',
      'git config user.email one-chat@local.invalid',
      'git add -A',
      'git commit -m Created Client Portal',
    ])
    expect(commandTimeouts.filter((timeout) => timeout !== undefined)).toEqual([180_000, 180_000])
    await vi.waitFor(() => expect(started).toEqual(['client-portal', 'client-portal-2']))
    expect(registry.urlFor(first)).toBe('https://client-portal.apps.test:6100/')
    expect(JSON.parse(await readFile(path.join(appsRoot, 'apps.json'), 'utf8'))).toMatchObject({
      apps: [
        { slug: 'client-portal', acceptedPort: 6100, candidatePort: 6101 },
        { slug: 'client-portal-2', acceptedPort: 6102, candidatePort: 6103 },
      ],
    })
    expect(await readFile(path.join(appsRoot, 'client-portal', 'src', 'index.ts'), 'utf8')).toBe('export {}\n')
  })

  test('fails visibly when the configured port range is exhausted', async () => {
    const { registry } = await fixture()
    await registry.init()
    await registry.create('One')
    await registry.create('Two')
    await registry.create('Three')
    await expect(registry.create('Four')).rejects.toThrow('No app port is available in 6100-6105')
  })

  test('discovers existing app folders through the workspace adapter', async () => {
    const { appsRoot, templateRoot, runtimeModeAdapter } = await fixture()
    await mkdir(path.join(appsRoot, 'julien-app'), { recursive: true })
    await writeFile(path.join(appsRoot, 'julien-app', 'package.json'), '{}\n')
    execFileSync('git', ['init', '-b', 'main'], { cwd: path.join(appsRoot, 'julien-app'), stdio: 'ignore' })
    execFileSync('git', ['-c', 'user.name=One Chat Test', '-c', 'user.email=test@invalid', 'add', '-A'], {
      cwd: path.join(appsRoot, 'julien-app'),
      stdio: 'ignore',
    })
    execFileSync('git', ['-c', 'user.name=One Chat Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'Ready'], {
      cwd: path.join(appsRoot, 'julien-app'),
      stdio: 'ignore',
    })
    const registry = createAppRegistry({
      appsRoot,
      templateRoot,
      runtimeModeAdapter,
      publicHost: '127.0.0.1',
      portStart: 6150,
      portEnd: 6152,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      runApp: async (_runtime, _app, signal) => pendingUntilAbort(signal),
    })
    registries.push(registry)

    await registry.init()
    expect(registry.list()).toMatchObject([{ slug: 'julien-app', title: 'Julien App', acceptedPort: 6150, candidatePort: 6151 }])
  })

  test('does not resurrect a partially provisioned app after restart', async () => {
    const { appsRoot, templateRoot, runtimeModeAdapter } = await fixture()
    const failing = createAppRegistry({
      appsRoot,
      templateRoot,
      runtimeModeAdapter,
      publicHost: '127.0.0.1',
      portStart: 6170,
      portEnd: 6172,
      isPortAvailable: async () => true,
      runCommand: async () => {
        throw new Error('deliberate install failure')
      },
      runApp: async (_runtime, _app, signal) => pendingUntilAbort(signal),
    })
    registries.push(failing)
    await failing.init()
    await expect(failing.create('Broken')).rejects.toThrow('deliberate install failure')
    expect((await readdir(appsRoot)).some((name) => name.startsWith('.provisioning-broken-'))).toBe(true)

    const started: string[] = []
    const restarted = createAppRegistry({
      appsRoot,
      templateRoot,
      runtimeModeAdapter,
      publicHost: '127.0.0.1',
      portStart: 6170,
      portEnd: 6172,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      runApp: async (_runtime, app, signal) => {
        started.push(app.slug)
        await pendingUntilAbort(signal)
      },
    })
    registries.push(restarted)
    await restarted.init()
    expect(restarted.list()).toEqual([])
    expect(started).toEqual([])
  })

  test('migrates ONE_CHAT_WORKSPACE_ROOT through adapter template materialization', async () => {
    const { root, appsRoot, templateRoot, runtimeModeAdapter } = await fixture()
    const legacyRoot = path.join(root, 'legacy-app')
    await mkdir(path.join(legacyRoot, 'agent', 'intents'), { recursive: true })
    await writeFile(path.join(legacyRoot, 'package.json'), '{}\n')
    await writeFile(path.join(legacyRoot, 'agent', 'instructions.md'), 'Keep this app.\n')
    const registry = createAppRegistry({
      appsRoot,
      templateRoot,
      legacyWorkspaceRoot: legacyRoot,
      runtimeModeAdapter,
      publicHost: '127.0.0.1',
      portStart: 6200,
      portEnd: 6202,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      runApp: async (_runtime, _app, signal) => pendingUntilAbort(signal),
    })
    registries.push(registry)

    await registry.init()
    expect(registry.list()).toMatchObject([{ slug: 'default', title: 'Default', acceptedPort: 6200, candidatePort: 6201 }])
    expect(await readFile(path.join(appsRoot, 'default', 'agent', 'instructions.md'), 'utf8')).toBe('Keep this app.\n')
  })

  test('skips ports already owned outside the registry', async () => {
    const { root, templateRoot, runtimeModeAdapter } = await fixture()
    const registry = createAppRegistry({
      appsRoot: path.join(root, 'occupied-port-apps'),
      templateRoot,
      runtimeModeAdapter,
      publicHost: '127.0.0.1',
      portStart: 6250,
      portEnd: 6252,
      isPortAvailable: async (port) => port !== 6250,
      runCommand: async () => {},
      runApp: async (_runtime, _app, signal) => pendingUntilAbort(signal),
    })
    registries.push(registry)

    await registry.init()
    await expect(registry.create('Available')).resolves.toMatchObject({
      acceptedPort: 6251,
      candidatePort: 6252,
    })
  })

  test('restarts a failed sandbox app process and aborts the live run on close', async () => {
    const { root, templateRoot, runtimeModeAdapter } = await fixture()
    let attempts = 0
    let finalSignal: AbortSignal | undefined
    const registry = createAppRegistry({
      appsRoot: path.join(root, 'restart-apps'),
      templateRoot,
      runtimeModeAdapter,
      publicHost: '127.0.0.1',
      portStart: 6270,
      portEnd: 6271,
      restartDelayMs: 1,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      runApp: async (_runtime, _app, signal) => {
        attempts += 1
        if (attempts === 1) throw new Error('failed')
        finalSignal = signal
        await pendingUntilAbort(signal)
      },
      logger: { info: () => {}, error: () => {} },
    })
    registries.push(registry)

    await registry.init()
    await registry.create('Retry')
    await vi.waitFor(() => expect(attempts).toBe(2))
    await registry.close()
    expect(finalSignal?.aborted).toBe(true)
  })
})
