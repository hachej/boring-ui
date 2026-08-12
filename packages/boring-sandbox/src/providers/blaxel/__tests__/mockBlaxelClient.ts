import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type {
  BlaxelClient,
  BlaxelProcessResult,
  BlaxelRemoteSandbox,
  BlaxelRemoteVolume,
} from '../client'

function notFound(message: string): Error {
  return Object.assign(new Error(message), { status: 404 })
}

export async function createMockBlaxelClient(): Promise<BlaxelClient & {
  readonly root: string
  readonly sandboxes: Map<string, BlaxelRemoteSandbox>
  readonly volumes: Map<string, BlaxelRemoteVolume>
  readonly kills: string[]
  readonly watchState: {
    callbacks: Set<(event: import('../client').BlaxelWatchEvent) => void | Promise<void>>
    closes: number
    starts: number
  }
  failGuestStagingMoveOn: number | undefined
}> {
  const root = join(tmpdir(), `boring-blaxel-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  const sandboxes = new Map<string, BlaxelRemoteSandbox>()
  const volumes = new Map<string, BlaxelRemoteVolume>()
  const processes = new Map<string, BlaxelProcessResult>()
  const children = new Map<string, ReturnType<typeof spawn>>()
  const kills: string[] = []
  const watchState = {
    callbacks: new Set<(event: import('../client').BlaxelWatchEvent) => void | Promise<void>>(),
    closes: 0,
    starts: 0,
  }
  let guestStagingMoveCount = 0
  let client!: BlaxelClient & {
    readonly root: string
    readonly sandboxes: Map<string, BlaxelRemoteSandbox>
    readonly volumes: Map<string, BlaxelRemoteVolume>
    readonly kills: string[]
    readonly watchState: typeof watchState
    failGuestStagingMoveOn: number | undefined
  }
  const mapPath = (path: string) => path === '/workspace'
    ? root
    : join(root, path.replace(/^\/workspace\/?/, ''))
  const mapCommand = (command: string) => command.replaceAll('/workspace', root)

  function remote(name: string, config: Parameters<BlaxelClient['createSandbox']>[0]): BlaxelRemoteSandbox {
    const spec = {
      region: config.region,
      runtime: { image: config.image, memory: config.memory, ttl: config.ttl },
      volumes: config.volumes,
      lifecycle: config.lifecycle,
    }
    const fs = {
      async mkdir(path: string) { await mkdir(mapPath(path)) },
      async write(path: string, content: string) { await writeFile(mapPath(path), content) },
      async writeBinary(path: string, content: Uint8Array) { await writeFile(mapPath(path), content) },
      async read(path: string) { return await readFile(mapPath(path), 'utf8') },
      async readBinary(path: string) { return new Blob([await readFile(mapPath(path))]) },
      async rm(path: string, recursive?: boolean) {
        const target = mapPath(path)
        if (recursive) {
          const { rm } = await import('node:fs/promises')
          await rm(target, { recursive: true })
        } else await unlink(target)
      },
      async ls(path: string) {
        const entries = await readdir(mapPath(path), { withFileTypes: true })
        return {
          name: path.split('/').at(-1) ?? '', path,
          files: await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
            const info = await stat(join(mapPath(path), entry.name))
            return { name: entry.name, path: `${path}/${entry.name}`, lastModified: info.mtime.toISOString(), size: info.size }
          })),
          subdirectories: entries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, path: `${path}/${entry.name}` })),
        }
      },
      watch(_path: string, callback: (event: import('../client').BlaxelWatchEvent) => void | Promise<void>) {
        watchState.starts += 1
        watchState.callbacks.add(callback)
        let closed = false
        return { close() {
          if (closed) return
          closed = true
          watchState.closes += 1
          watchState.callbacks.delete(callback)
        } }
      },
    }
    const processApi = {
      async exec(request: {
        command: string; env?: Record<string, string>; name?: string; waitForCompletion?: boolean; workingDir?: string
      }) {
        const id = request.name ?? `helper-${Date.now()}-${Math.random()}`
        const running: BlaxelProcessResult = {
          command: request.command, exitCode: 0, name: id, pid: id, status: 'running',
          stderr: '', stdout: '', workingDir: request.workingDir ?? '/workspace',
        }
        if (request.command.includes('mv -T --') && request.command.includes('staging-')) {
          guestStagingMoveCount += 1
          if (client.failGuestStagingMoveOn === guestStagingMoveCount) {
            client.failGuestStagingMoveOn = undefined
            return { ...running, exitCode: 1, status: 'failed' as const, stderr: 'injected staging move failure' }
          }
        }
        processes.set(id, running)
        const child = spawn('sh', ['-c', mapCommand(request.command)], {
          cwd: mapPath(request.workingDir ?? '/workspace'),
          env: { ...process.env, ...request.env },
        })
        children.set(id, child)
        const stdout: Uint8Array[] = []
        const stderr: Uint8Array[] = []
        child.stdout?.on('data', (chunk: Uint8Array) => stdout.push(chunk))
        child.stderr?.on('data', (chunk: Uint8Array) => stderr.push(chunk))
        const completed = new Promise<BlaxelProcessResult>((resolve) => child.once('close', (code, signal) => {
          const result: BlaxelProcessResult = {
            ...running,
            exitCode: code ?? (signal ? 137 : 1),
            status: signal ? 'killed' : code === 0 ? 'completed' : 'failed',
            stdout: Buffer.concat(stdout).toString('utf8').replaceAll(root, '/workspace'),
            stderr: Buffer.concat(stderr).toString('utf8').replaceAll(root, '/workspace'),
          }
          processes.set(id, result)
          children.delete(id)
          resolve(result)
        }))
        return request.waitForCompletion ? await completed : running
      },
      async get(id: string) {
        const result = processes.get(id)
        if (!result) throw notFound('process not found')
        return result
      },
      async kill(id: string) {
        kills.push(id)
        const child = children.get(id)
        if (!child) throw notFound('process not found')
        child.kill('SIGKILL')
      },
    }
    return { name, externalId: config.externalId, status: 'DEPLOYED', spec, fs, process: processApi }
  }

  client = {
    root,
    sandboxes,
    volumes,
    kills,
    watchState,
    failGuestStagingMoveOn: undefined,
    async getSandbox(name) {
      const value = sandboxes.get(name)
      if (!value) throw notFound('sandbox not found')
      return value
    },
    async createSandbox(config) {
      const name = config.name!
      const existing = sandboxes.get(name)
      if (existing && !/failed|terminated/i.test(existing.status ?? '')) return existing
      const value = remote(name, config)
      sandboxes.set(name, value)
      return value
    },
    async getVolume(name) {
      const value = volumes.get(name)
      if (!value) throw notFound('volume not found')
      return value
    },
    async createVolume(config) {
      const value = { name: config.name!, spec: { region: config.region, size: config.size } }
      volumes.set(value.name, value)
      return value
    },
    async getVolumeAttachment() { return undefined },
  }
  return client
}
