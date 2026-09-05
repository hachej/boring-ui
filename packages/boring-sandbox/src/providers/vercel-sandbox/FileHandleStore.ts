import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import lockfile from 'proper-lockfile'
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '@hachej/boring-agent/shared'

const DEFAULT_STORE_PATH = path.join(
  homedir(),
  '.config',
  'boring-agent',
  'sandboxes.json',
)

export interface FileHandleStoreOptions {
  storePath?: string
}

type PersistedHandles = Record<string, SandboxHandleRecord>

export class FileHandleStore implements SandboxHandleStore {
  private readonly storePath: string

  constructor(opts: FileHandleStoreOptions = {}) {
    this.storePath = path.resolve(opts.storePath ?? DEFAULT_STORE_PATH)
  }

  async get(workspaceId: string): Promise<SandboxHandleRecord | null> {
    const store = await this.readStore()
    return store[workspaceId] ?? null
  }

  async put(record: SandboxHandleRecord): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore()
      store[record.workspaceId] = record
      await this.writeStore(store)
    })
  }

  async delete(workspaceId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore()
      if (!(workspaceId in store)) {
        return
      }
      delete store[workspaceId]
      await this.writeStore(store)
    })
  }

  async list(): Promise<SandboxHandleRecord[]> {
    const store = await this.readStore()
    return Object.values(store)
  }

  private async withMutationLock(operation: () => Promise<void>): Promise<void> {
    const directory = path.dirname(this.storePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // The file need not exist yet; canonicalize its parent so aliases share a lock.
    const canonicalStorePath = path.join(await realpath(directory), path.basename(this.storePath))
    const release = await lockfile.lock(canonicalStorePath, {
      realpath: false,
      stale: 30_000,
      update: 5_000,
      retries: { retries: 100, minTimeout: 25, maxTimeout: 100 },
    })
    try {
      await operation()
    } finally {
      await release()
    }
  }

  private async readStore(): Promise<PersistedHandles> {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      if (!raw.trim()) {
        return {}
      }
      return JSON.parse(raw) as PersistedHandles
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'ENOENT') {
        return {}
      }
      throw error
    }
  }

  private async writeStore(store: PersistedHandles): Promise<void> {
    const tmpPath = `${this.storePath}.tmp-${randomUUID()}`
    const content = `${JSON.stringify(store, null, 2)}\n`
    const tmpFile = await open(tmpPath, 'wx', 0o600)

    try {
      try {
        await tmpFile.chmod(0o600)
        await tmpFile.writeFile(content, 'utf8')
      } finally {
        await tmpFile.close()
      }
      await rename(tmpPath, this.storePath)
    } finally {
      try {
        await unlink(tmpPath)
      } catch {
        // A successful rename already removed the temporary path.
      }
    }
  }
}
