import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAppRegistry } from '../appRegistry'

const registries: Array<{ close(): Promise<void> }> = []

class FakeChild extends EventEmitter {
  pid = undefined
  exitCode: number | null = 0
  kill() { return true }
}

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.close()))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-registry-'))
  const appsRoot = path.join(root, 'apps')
  const templateRoot = path.join(root, 'template')
  await mkdir(path.join(templateRoot, 'src'), { recursive: true })
  await writeFile(path.join(templateRoot, 'package.json'), '{"scripts":{"db:push":"true"}}\n')
  await writeFile(path.join(templateRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(path.join(templateRoot, 'src', 'index.ts'), 'export {}\n')
  const commands: string[] = []
  const started: string[] = []
  const registry = createAppRegistry({
    appsRoot,
    templateRoot,
    publicHost: 'apps.test',
    appUrlPattern: 'https://{slug}.apps.test:{port}/',
    portStart: 6100,
    portEnd: 6102,
    isPortAvailable: async () => true,
    runCommand: async (command, args, cwd) => {
      const destination = path.basename(cwd).includes('client-portal-2') ? 'client-portal-2' : 'client-portal'
      commands.push(`${command} ${args.join(' ')} @ ${destination}`)
    },
    spawnApp: (app) => {
      started.push(app.slug)
      return new FakeChild() as unknown as ChildProcess
    },
  })
  registries.push(registry)
  return { root, appsRoot, templateRoot, registry, commands, started }
}

describe('app registry', () => {
  test('creates, installs, pushes the database, lists, and persists apps', async () => {
    const { appsRoot, registry, commands, started } = await fixture()
    await registry.init()

    const first = await registry.create('Client Portal')
    const second = await registry.create('Client Portal')

    expect(first).toMatchObject({ slug: 'client-portal', title: 'Client Portal', port: 6100 })
    expect(second).toMatchObject({ slug: 'client-portal-2', port: 6101 })
    expect(registry.list().map((app) => app.slug)).toEqual(['client-portal', 'client-portal-2'])
    expect(commands).toEqual([
      'pnpm install --frozen-lockfile --config.minimum-release-age=0 --config.dangerously-allow-all-builds=true @ client-portal',
      'pnpm run db:push @ client-portal',
      'pnpm install --frozen-lockfile --config.minimum-release-age=0 --config.dangerously-allow-all-builds=true @ client-portal-2',
      'pnpm run db:push @ client-portal-2',
    ])
    expect(started).toEqual(['client-portal', 'client-portal-2'])
    expect(registry.urlFor(first)).toBe('https://client-portal.apps.test:6100/')
    expect(JSON.parse(await readFile(path.join(appsRoot, 'apps.json'), 'utf8'))).toMatchObject({
      apps: [{ slug: 'client-portal', port: 6100 }, { slug: 'client-portal-2', port: 6101 }],
    })
  })

  test('fails visibly when the configured port range is exhausted', async () => {
    const { registry } = await fixture()
    await registry.init()
    await registry.create('One')
    await registry.create('Two')
    await registry.create('Three')
    await expect(registry.create('Four')).rejects.toThrow('No app port is available in 6100-6102')
  })

  test('discovers existing app folders when the legacy variable points at the apps root', async () => {
    const { appsRoot, templateRoot } = await fixture()
    await mkdir(path.join(appsRoot, 'julien-app'), { recursive: true })
    await writeFile(path.join(appsRoot, 'julien-app', 'package.json'), '{}\n')
    const registry = createAppRegistry({
      appsRoot,
      templateRoot,
      legacyWorkspaceRoot: appsRoot,
      publicHost: '127.0.0.1',
      portStart: 6150,
      portEnd: 6152,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      spawnApp: () => new FakeChild() as unknown as ChildProcess,
    })
    registries.push(registry)

    await registry.init()

    expect(registry.list()).toMatchObject([{ slug: 'julien-app', title: 'Julien App', port: 6150 }])
  })

  test('migrates ONE_CHAT_WORKSPACE_ROOT into the default app on first boot', async () => {
    const { root, appsRoot, templateRoot } = await fixture()
    const legacyRoot = path.join(root, 'legacy-app')
    await mkdir(path.join(legacyRoot, 'agent', 'intents'), { recursive: true })
    await writeFile(path.join(legacyRoot, 'package.json'), '{}\n')
    await writeFile(path.join(legacyRoot, 'agent', 'instructions.md'), 'Keep this app.\n')
    const started: string[] = []
    const registry = createAppRegistry({
      appsRoot,
      templateRoot,
      legacyWorkspaceRoot: legacyRoot,
      publicHost: '127.0.0.1',
      portStart: 6200,
      portEnd: 6202,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      spawnApp: (app) => {
        started.push(app.slug)
        return new FakeChild() as unknown as ChildProcess
      },
    })
    registries.push(registry)

    await registry.init()

    expect(registry.list()).toMatchObject([{ slug: 'default', title: 'Default', port: 6200 }])
    expect(await readFile(path.join(appsRoot, 'default', 'agent', 'instructions.md'), 'utf8')).toBe('Keep this app.\n')
    expect(started).toEqual(['default'])
  })

  test('skips ports already owned outside the registry', async () => {
    const { root, templateRoot } = await fixture()
    const registry = createAppRegistry({
      appsRoot: path.join(root, 'occupied-port-apps'),
      templateRoot,
      publicHost: '127.0.0.1',
      portStart: 6250,
      portEnd: 6252,
      isPortAvailable: async (port) => port !== 6250,
      runCommand: async () => {},
      spawnApp: () => new FakeChild() as unknown as ChildProcess,
    })
    registries.push(registry)

    await registry.init()
    await expect(registry.create('Available')).resolves.toMatchObject({ port: 6251 })
  })

  test('restarts an app when spawning emits an error without exit', async () => {
    const { root, templateRoot } = await fixture()
    let attempts = 0
    const registry = createAppRegistry({
      appsRoot: path.join(root, 'spawn-error-apps'),
      templateRoot,
      publicHost: '127.0.0.1',
      portStart: 6270,
      portEnd: 6270,
      restartDelayMs: 1,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      spawnApp: () => {
        attempts += 1
        const child = new FakeChild()
        if (attempts === 1) queueMicrotask(() => child.emit('error', new Error('spawn failed')))
        return child as unknown as ChildProcess
      },
      logger: { info: () => {}, error: () => {} },
    })
    registries.push(registry)

    await registry.init()
    await registry.create('Retry')
    await vi.waitFor(() => expect(attempts).toBe(2))
  })

  test('terminates the real app process group on close', async () => {
    const { root, templateRoot } = await fixture()
    let child: ChildProcess | undefined
    const registry = createAppRegistry({
      appsRoot: path.join(root, 'real-process-apps'),
      templateRoot,
      publicHost: '127.0.0.1',
      portStart: 6300,
      portEnd: 6300,
      isPortAvailable: async () => true,
      runCommand: async () => {},
      spawnApp: () => {
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
          detached: process.platform !== 'win32',
          stdio: 'ignore',
        })
        return child
      },
    })
    registries.push(registry)

    await registry.init()
    await registry.create('Process')
    const pid = child?.pid
    expect(pid).toBeTypeOf('number')
    await registry.close()
    expect(() => process.kill(pid!, 0)).toThrow()
  })
})
