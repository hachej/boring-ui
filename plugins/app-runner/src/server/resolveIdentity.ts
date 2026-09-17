import type { FastifyRequest } from "fastify"
import type { ToolExecContext } from "@hachej/boring-workspace/shared"
import type { AppRunnerIdentity } from "../shared/types"

/** Identity is derived only from trusted execution/session context. */
export function identityFromToolContext(ctx: Pick<ToolExecContext, "userId" | "userEmail">): AppRunnerIdentity {
  const id = ctx.userId?.trim()
  if (!id) throw new Error("authenticated user identity is required")
  return { id, name: ctx.userEmail ?? id, email: ctx.userEmail }
}

export function identityFromRequest(request: FastifyRequest): AppRunnerIdentity {
  const user = (request as FastifyRequest & {
    user?: { id?: string; name?: string | null; email?: string | null } | null
  }).user
  const id = user?.id?.trim()
  if (id) return { id, name: user?.name?.trim() || user?.email?.trim() || id, ...(user?.email ? { email: user.email } : {}) }

  // Standalone hosts authenticate one local seat with their server-held bearer
  // token. Never substitute caller-controlled identity headers.
  return { id: "local", name: "Local user" }
}
