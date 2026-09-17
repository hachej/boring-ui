import type { ToolExecContext } from "@hachej/boring-workspace/shared"

/** Resolve only the workspace admitted into the executing tool context. */
export function resolveWorkspaceId(ctx: Pick<ToolExecContext, "workspaceId">, _workspaceRoot: string): string {
  const workspaceId = ctx.workspaceId?.trim()
  if (!workspaceId) throw new Error("authenticated workspace identity is required")
  return workspaceId
}
