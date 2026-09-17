import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { AppRunnerRecord } from "../shared/types"

/**
 * Small JSON-file store recording the apps this workspace has published,
 * mirroring the pattern used by `plugins/ask-user`'s `FileAskUserStore`
 * (a single JSON document under `.boring/`, written atomically via a
 * temp-file rename).
 */
export interface AppRunnerStore {
  listApps(): Promise<AppRunnerRecord[]>
  upsertApp(record: AppRunnerRecord): Promise<void>
}

type StoredAppRunnerState = {
  apps: Record<string, AppRunnerRecord>
}

const EMPTY_STATE: StoredAppRunnerState = { apps: {} }

export class FileAppRunnerStore implements AppRunnerStore {
  private state: StoredAppRunnerState | null = null
  private loadInFlight: Promise<StoredAppRunnerState> | null = null
  private writeChain = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async listApps(): Promise<AppRunnerRecord[]> {
    const state = await this.load()
    return Object.values(state.apps).sort((a, b) => a.appName.localeCompare(b.appName))
  }

  async upsertApp(record: AppRunnerRecord): Promise<void> {
    await this.mutate((state) => {
      state.apps[record.appName] = record
    })
  }

  private async load(): Promise<StoredAppRunnerState> {
    if (this.state) return this.state
    if (this.loadInFlight) return this.loadInFlight
    this.loadInFlight = (async () => {
      try {
        const raw = await readFile(this.filePath, "utf8")
        const parsed = JSON.parse(raw) as Partial<StoredAppRunnerState>
        this.state = { apps: parsed.apps ?? {} }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        this.state = structuredClone(EMPTY_STATE)
      }
      return this.state!
    })()
    try {
      return await this.loadInFlight
    } finally {
      this.loadInFlight = null
    }
  }

  private async mutate(fn: (state: StoredAppRunnerState) => void): Promise<void> {
    const state = await this.load()
    fn(state)
    this.state = state
    this.writeChain = this.writeChain.then(() => this.persist(state))
    await this.writeChain
  }

  private async persist(state: StoredAppRunnerState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8")
    await rename(tmpPath, this.filePath)
  }
}
