import { basename } from "node:path"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"

/**
 * Resolves the workspace id used to namespace apps on the app runner
 * (`{workspaceId}--{appName}`). `ToolExecContext.workspaceId` is populated
 * when the host authenticates a request; local/dev harnesses that don't set
 * it fall back to the workspace root's basename, matching the convention
 * `apps/workspace-playground`'s `/api/v1/workspace/meta` route already uses
 * for its own `workspaceId` field.
 */
export function resolveWorkspaceId(ctx: Pick<ToolExecContext, "workspaceId">, workspaceRoot: string): string {
  return ctx.workspaceId ?? basename(workspaceRoot) ?? "default"
}
