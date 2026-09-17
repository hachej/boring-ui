import type { AppRunnerRecord } from "../../shared/types"
import type { AppRunnerStore } from "../appRunnerStore"

export class MemoryAppRunnerStore implements AppRunnerStore {
  private readonly apps = new Map<string, AppRunnerRecord>()

  async listApps(): Promise<AppRunnerRecord[]> {
    return [...this.apps.values()]
  }

  async upsertApp(record: AppRunnerRecord): Promise<void> {
    this.apps.set(record.appName, record)
  }
}
