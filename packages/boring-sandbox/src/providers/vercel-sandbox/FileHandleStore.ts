import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from './sandboxHandleStore'

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
    this.storePath = opts.storePath ?? DEFAULT_STORE_PATH
  }

  async get(workspaceId: string): Promise<SandboxHandleRecord | null> {
    const store = await this.readStore()
    return store[workspaceId] ?? null
  }

  async put(record: SandboxHandleRecord): Promise<void> {
    const store = await this.readStore()
    store[record.workspaceId] = record
    await this.writeStore(store)
  }

  async delete(workspaceId: string): Promise<void> {
    const store = await this.readStore()
    if (!(workspaceId in store)) {
      return
    }
    delete store[workspaceId]
    await this.writeStore(store)
  }

  async list(): Promise<SandboxHandleRecord[]> {
    const store = await this.readStore()
    return Object.values(store)
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
    await mkdir(path.dirname(this.storePath), { recursive: true, mode: 0o700 })

    const tmpPath = `${this.storePath}.tmp-${process.pid}-${Date.now()}`
    const content = `${JSON.stringify(store, null, 2)}\n`

    let tmpWritten = false
    let renamed = false

    try {
      await writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 })
      tmpWritten = true
      await chmod(tmpPath, 0o600)

      await rename(tmpPath, this.storePath)
      renamed = true
      await chmod(this.storePath, 0o600)
    } finally {
      if (tmpWritten && !renamed) {
        try {
          await unlink(tmpPath)
        } catch {
          // tmp may already be gone.
        }
      }
    }
  }
}
