import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, it, vi } from "vitest"
import type { TaskSessionLinkWorkspace } from "./taskSessionLinkStore"
import { createTrustedTaskToolBindingResolver } from "./taskToolBinding"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly files = new Map<string, string>()

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path)
    if (value === undefined) throw Object.assign(new Error("missing"), { code: TASK_ERROR_CODES.WORKSPACE_FILE_MISSING })
    return value
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async mkdir(): Promise<void> {}

  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from)
    if (value === undefined) throw new Error("missing source")
    this.files.set(to, value)
    this.files.delete(from)
  }
}

function trusted(options: { workspace?: MemoryWorkspace; actorAllowed?: boolean; authorizeError?: boolean } = {}) {
  const workspace = options.workspace ?? new MemoryWorkspace()
  const resolveWithWorkspace = vi.fn(async () => ({ dispatcher: {} as never, workspace: workspace as never }))
  const authorizeSession = options.authorizeError
    ? vi.fn(async () => { throw new Error("missing or denied") })
    : vi.fn(async () => {})
  return {
    workspace,
    resolveWithWorkspace,
    authorizeSession,
    context: {
      actorResolver: vi.fn(),
      actorVerifier: vi.fn(async () => options.actorAllowed !== false),
      workspaceAgentDispatcherResolver: {
        resolve: vi.fn(),
        resolveWithWorkspace,
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
  it("resolves actor and Workspace only from authoritative tool context", async () => {
    const fixture = trusted()
    const resolver = createTrustedTaskToolBindingResolver(fixture.context)

    const first = await resolver.resolve(runContext)
    const second = await resolver.resolve({ ...runContext, toolCallId: "second" })

    expect(first.actor).toEqual({ workspaceId: "workspace-a", userId: "user-a" })
    expect(first.workspace).toBe(fixture.workspace)
    expect(second.linkStore).toBe(first.linkStore)
    expect(fixture.resolveWithWorkspace).toHaveBeenCalledTimes(2)
    expect(fixture.resolveWithWorkspace).toHaveBeenCalledWith({ workspaceId: "workspace-a", userId: "user-a" })
  })

  it.each([
    { workspaceId: undefined, userId: "user-a" },
    { workspaceId: "workspace-a", userId: undefined },
    { workspaceId: " ", userId: "user-a" },
  ])("fails closed when authenticated identity is incomplete: %o", async (identity) => {
    const fixture = trusted()
    const resolver = createTrustedTaskToolBindingResolver(fixture.context)

    await expect(resolver.resolve({ ...runContext, ...identity })).rejects.toMatchObject({
      code: TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
    })
    expect(fixture.resolveWithWorkspace).not.toHaveBeenCalled()
  })

  it("fails closed when actor verification or trusted resolution fails", async () => {
    const denied = trusted({ actorAllowed: false })
    await expect(createTrustedTaskToolBindingResolver(denied.context).resolve(runContext)).rejects.toMatchObject({
      code: TASK_ERROR_CODES.TOOL_FORBIDDEN,
    })

    await expect(createTrustedTaskToolBindingResolver(undefined).resolve(runContext)).rejects.toMatchObject({
      code: TASK_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
    })
  })

  it("authorizes explicit sessions in the same resolved actor scope without disclosure", async () => {
    const allowed = trusted()
    const binding = await createTrustedTaskToolBindingResolver(allowed.context).resolve(runContext)
    await binding.authorizeSession("session-b")
    expect(allowed.authorizeSession).toHaveBeenCalledWith(
      { workspaceId: "workspace-a", userId: "user-a" },
      "session-b",
    )

    const denied = trusted({ authorizeError: true })
    const deniedBinding = await createTrustedTaskToolBindingResolver(denied.context).resolve(runContext)
    await expect(deniedBinding.authorizeSession("missing-or-denied")).rejects.toMatchObject({
      code: TASK_ERROR_CODES.TOOL_FORBIDDEN,
      message: "Task session access is forbidden.",
    })
  })
})
