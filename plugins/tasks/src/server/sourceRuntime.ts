import type { BoringTaskAdapterSummary, BoringTaskBoardConfig, BoringTaskCard, BoringTaskDeleteInput, BoringTaskMoveInput } from "../shared"

export interface BoringTaskSourceContext {
  workspaceId?: string
  /** Trusted Workspace binding used by tools/new routes. */
  workspace?: { readonly root: string }
  /** Legacy compatibility for existing local HTTP adapters. */
  workspaceRoot?: string
}

export type BoringTaskSourceSummary = BoringTaskAdapterSummary

export interface BoringTaskSourceRuntime {
  summary(): BoringTaskSourceSummary
  getBoardConfig(ctx: BoringTaskSourceContext): Promise<BoringTaskBoardConfig> | BoringTaskBoardConfig
  listTasks(ctx: BoringTaskSourceContext): Promise<BoringTaskCard[]> | BoringTaskCard[]
  getTask?(ctx: BoringTaskSourceContext, taskId: string): Promise<BoringTaskCard | undefined> | BoringTaskCard | undefined
  moveTask?(ctx: BoringTaskSourceContext, input: BoringTaskMoveInput): Promise<BoringTaskCard> | BoringTaskCard
  deleteTask?(ctx: BoringTaskSourceContext, input: BoringTaskDeleteInput): Promise<void> | void
}

export interface BoringTaskSourceRegistry {
  listSources(): BoringTaskSourceRuntime[]
  getSource(sourceId: string): BoringTaskSourceRuntime | undefined
}

export function createTaskSourceRegistry(sources: readonly BoringTaskSourceRuntime[]): BoringTaskSourceRegistry {
  const byId = new Map<string, BoringTaskSourceRuntime>()
  for (const source of sources) {
    const id = source.summary().id
    if (byId.has(id)) throw new Error(`Duplicate task source id: ${id}`)
    byId.set(id, source)
  }
  return {
    listSources: () => [...sources],
    getSource: (sourceId) => byId.get(sourceId),
  }
}
