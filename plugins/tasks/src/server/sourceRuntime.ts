import type { BoringTaskAdapterSummary, BoringTaskBoardConfig, BoringTaskCard, BoringTaskMoveInput } from "../shared"

export interface BoringTaskSourceContext {
  workspaceId?: string
}

export type BoringTaskSourceSummary = BoringTaskAdapterSummary

export interface BoringTaskSourceRuntime {
  summary(): BoringTaskSourceSummary
  getBoardConfig(ctx: BoringTaskSourceContext): Promise<BoringTaskBoardConfig> | BoringTaskBoardConfig
  listTasks(ctx: BoringTaskSourceContext): Promise<BoringTaskCard[]> | BoringTaskCard[]
  moveTask?(ctx: BoringTaskSourceContext, input: BoringTaskMoveInput): Promise<BoringTaskCard> | BoringTaskCard
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
