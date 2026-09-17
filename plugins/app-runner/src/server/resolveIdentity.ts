import type { FastifyRequest } from "fastify"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import type { AppRunnerIdentity } from "../shared/types"

/**
 * Builds the `{id, name, email}` identity the app runner's forward-auth
 * contract expects (APP-RUNNER-SPEC.md "Identity and access").
 *
 * Assumption: neither `ToolExecContext` nor this plugin's own Fastify routes
 * currently carry a standardized authenticated "name" field (only
 * `userId`/`userEmail` — see `packages/workspace/src/shared/types/agent-tool.ts`),
 * so `name` falls back to the id/email when a display name isn't available.
 */
export function identityFromToolContext(ctx: Pick<ToolExecContext, "userId" | "userEmail">): AppRunnerIdentity {
  const id = ctx.userId ?? "unknown"
  return { id, name: ctx.userEmail ?? id, email: ctx.userEmail }
}

export function identityFromRequest(request: FastifyRequest): AppRunnerIdentity {
  const id = headerString(request, "x-boring-user-id") ?? "unknown"
  const name = headerString(request, "x-boring-user-name") ?? headerString(request, "x-boring-user-email") ?? id
  const email = headerString(request, "x-boring-user-email")
  return { id, name, email }
}

function headerString(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
