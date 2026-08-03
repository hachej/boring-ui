import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, it, vi } from "vitest"
import type { TaskSessionLinkWorkspace } from "./taskSessionLinkStore"
import { createTrustedTaskToolBindingResolver } from "./taskToolBinding"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly root = "/workspace"
  readonly files = new Map<string, string>()
  async readFile(path: string) { const value = this.files.get(path); if (value === undefined) throw Object.assign(new Error("missing"), { code: TASK_ERROR_CODES.WORKSPACE_FILE_MISSING }); return value }
  async writeFile(path: string, content: string) { this.files.set(path, content) }
  async mkdir() {}
  async rename(from: string, to: string) { const value = this.files.get(from); if (value === undefined) throw new Error("missing source"); this.files.set(to, value); this.files.delete(from) }
}

function trusted(options: { actorAllowed?: boolean; authorizeError?: boolean } = {}) {
  const workspace = new MemoryWorkspace()
  const authorizeSession = options.authorizeError
    ? vi.fn(async () => { throw new Error("missing or denied") })
    : vi.fn(async () => undefined)
  const runWithWorkspaceAgent = vi.fn(async (_input, run) => { await run({ workspace } as never) })
  return {
    workspace,
    authorizeSession,
    runWithWorkspaceAgent,
    context: {
      actorResolver: vi.fn(),
      actorVerifier: vi.fn(async () => options.actorAllowed !== false),
      workspaceAgentDispatcherResolver: {
        resolve: vi.fn(),
        runWithWorkspaceAgent,
        authorizeSession,
      },
    },
  }
}

const runContext = {
  abortSignal: new AbortController().signal,
  toolCallId: "tool-call",
  sessionId: "native-session",
  workspaceId: " workspace-a ",
  userId: " user-a ",
}

describe("createTrustedTaskToolBindingResolver", () => {
  it("keeps Workspace use inside the authoritative Host lease", async () => {
    const fixture = trusted()
    const resolver = createTrustedTaskToolBindingResolver(fixture.context, "alpha")
    await expect(resolver.run(runContext, async (binding) => ({ actor: binding.actor, workspace: binding.workspace, agentTypeId: binding.agentTypeId }))).resolves.toEqual({
      actor: { workspaceId: "workspace-a", userId: "user-a" },
      workspace: fixture.workspace,
      agentTypeId: "alpha",
    })
    expect(fixture.runWithWorkspaceAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentTypeId: "alpha",
      context: { workspaceId: "workspace-a", userId: "user-a" },
      requestId: "tool-call",
    }), expect.any(Function))
  })

  it.each([
    { workspaceId: undefined, userId: "user-a" },
    { workspaceId: "workspace-a", userId: undefined },
    { workspaceId: " ", userId: "user-a" },
  ])("fails closed when authenticated identity is incomplete: %o", async (identity) => {
    const fixture = trusted()
    const resolver = createTrustedTaskToolBindingResolver(fixture.context, "alpha")
    await expect(resolver.run({ ...runContext, ...identity }, async () => undefined)).rejects.toMatchObject({ code: TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE })
    expect(fixture.runWithWorkspaceAgent).not.toHaveBeenCalled()
  })

  it("fails closed when actor verification or trusted resolution fails", async () => {
    const denied = trusted({ actorAllowed: false })
    await expect(createTrustedTaskToolBindingResolver(denied.context, "alpha").run(runContext, async () => undefined)).rejects.toMatchObject({ code: TASK_ERROR_CODES.TOOL_FORBIDDEN })
    await expect(createTrustedTaskToolBindingResolver(undefined, "alpha").run(runContext, async () => undefined)).rejects.toMatchObject({ code: TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE })
  })

  it("authorizes exact addressed sessions without transcript disclosure", async () => {
    const allowed = trusted()
    await createTrustedTaskToolBindingResolver(allowed.context, "alpha").run(runContext, async (binding) => binding.authorizeSession("session-b"))
    expect(allowed.authorizeSession).toHaveBeenCalledWith(
      { workspaceId: "workspace-a", userId: "user-a" },
      { agentTypeId: "alpha", sessionId: "session-b" },
    )
    const denied = trusted({ authorizeError: true })
    await expect(createTrustedTaskToolBindingResolver(denied.context, "alpha").run(runContext, async (binding) => binding.authorizeSession("missing-or-denied"))).rejects.toMatchObject({
      code: TASK_ERROR_CODES.TOOL_FORBIDDEN,
      message: "Task session access is forbidden.",
    })
  })
})
