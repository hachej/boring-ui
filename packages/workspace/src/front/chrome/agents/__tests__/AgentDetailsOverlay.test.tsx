import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AgentDetailsOverlay } from "../AgentDetailsOverlay"

const mocks = vi.hoisted(() => {
  const getJson = vi.fn()
  const postJson = vi.fn()
  return {
    getJson,
    postJson,
    client: { getJson, postJson, agentTypeId: "default" } as { getJson: typeof getJson; postJson: typeof postJson; agentTypeId: string } | null,
    postUiCommand: vi.fn(),
  }
})

vi.mock("../../../plugin/useWorkspacePluginClient", () => ({
  useOptionalWorkspacePluginClient: () => mocks.client,
}))

vi.mock("../../../bridge", () => ({
  postUiCommand: mocks.postUiCommand,
}))

const agent = {
  agentTypeId: "concierge",
  label: "Concierge",
  description: "Routes work to the right agent.",
  pluginIds: ["ask-user"],
}

function respond(payloads: {
  describe?: unknown
  skills?: unknown
  tools?: unknown
  models?: unknown
  rootTree?: unknown
  /** Paths that exist for the pre-open probe. `undefined` ⇒ everything exists. */
  existingFiles?: readonly string[]
  /** Transient probe failures to return before normal existence handling. */
  probeErrors?: readonly Error[]
}) {
  let probeIndex = 0
  mocks.getJson!.mockImplementation(async (path: string) => {
    // The overlay probes `GET /api/v1/files?path=…` before dispatching an
    // openFile, so a well-formed ref pointing at nothing degrades visibly
    // instead of 404-ing silently inside the viewer.
    if (path.startsWith("/api/v1/files?")) {
      const requested = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("path") ?? ""
      const probeError = payloads.probeErrors?.[probeIndex++]
      if (probeError) throw probeError
      if (payloads.existingFiles && !payloads.existingFiles.includes(requested)) {
        throw Object.assign(new Error(`404 ${requested}`), { status: 404 })
      }
      return { path: requested, content: "" }
    }
    const table: Array<[boolean, unknown, unknown]> = [
      [path.endsWith("/describe"), payloads.describe, {}],
      [path.endsWith("/skills"), payloads.skills, { skills: [] }],
      [path.endsWith("/tools"), payloads.tools, { tools: [] }],
      [path.endsWith("/models"), payloads.models, { models: [] }],
      [path.startsWith("/api/v1/tree"), payloads.rootTree, { entries: [] }],
    ]
    for (const [match, value, fallback] of table) {
      if (!match) continue
      if (value instanceof Error) throw value
      return value ?? fallback
    }
    throw new Error(`unexpected path ${path}`)
  })
}

function renderOverlay() {
  return render(
    <AgentDetailsOverlay
      agent={agent}
      onClose={vi.fn()}
    />,
  )
}

describe("AgentDetailsOverlay", () => {
  beforeEach(() => {
    mocks.getJson.mockReset()
    mocks.postUiCommand.mockReset()
    mocks.postJson.mockReset()
    mocks.client = { getJson: mocks.getJson, postJson: mocks.postJson, agentTypeId: "default" }
  })

  it("renders all capability sections from the server projection", async () => {
    respond({
      describe: {
        mcpServers: [{ id: "github", tools: ["create_issue", "get_pr"] }],
      },
      skills: {
        skills: [
          {
            name: "triage",
            description: "Sort incoming work.",
            source: "project",
            resource: { filesystem: "user", path: ".agents/skills/triage/SKILL.md" },
          },
        ],
      },
      tools: { tools: [{ name: "read_file", description: "Read a file from the workspace." }] },
    })
    renderOverlay()

    expect(await screen.findByText("/triage")).toBeInTheDocument()
    expect(screen.getByText("read_file")).toBeInTheDocument()
    expect(screen.getByText("github")).toBeInTheDocument()
    expect(screen.getByText("2 tools")).toBeInTheDocument()
    expect(screen.getByText("create_issue, get_pr")).toBeInTheDocument()
    // Plugin ids are the fleet LIST's fact; /describe no longer restates them
    // in a second shape for the client to reconcile.
    expect(screen.getByText("ask-user")).toBeInTheDocument()
    // The old developer-jargon copy never renders.
    expect(screen.queryByText(/Runtime plugins explicitly bound/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Workspace UI plugins do not automatically/)).not.toBeInTheDocument()
    // Round 3: no New chat button, no readiness blurb, no Chats/Status strip.
    expect(screen.queryByRole("button", { name: /New chat/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/is ready to chat and work/)).not.toBeInTheDocument()
    expect(screen.queryByText("Chats")).not.toBeInTheDocument()
    expect(screen.queryByText("Status")).not.toBeInTheDocument()
  })

  it("shows the resolved default model in the Defaults section", async () => {
    respond({
      describe: { model: "claude-fable-5", mcpServers: [] },
      models: { models: [{ id: "claude-fable-5", label: "Fable 5" }], defaultModel: { id: "claude-fable-5" } },
    })
    renderOverlay()

    expect(await screen.findByText("Defaults")).toBeInTheDocument()
    expect(screen.getByText("Default model")).toBeInTheDocument()
    expect(screen.getByText("Fable 5")).toBeInTheDocument()
  })

  it("falls back to the host default model label when the agent pins none", async () => {
    respond({
      describe: { mcpServers: [] },
      models: { models: [{ id: "gpt-x", label: "GPT X" }], defaultModel: { id: "gpt-x" } },
    })
    renderOverlay()

    expect(await screen.findByText("Default model")).toBeInTheDocument()
    expect(screen.getByText("GPT X")).toBeInTheDocument()
  })

  it("opens a skill through the workbench command path", async () => {
    respond({
      skills: {
        skills: [{
          name: "triage",
          resource: { filesystem: "user", path: ".agents/skills/triage/SKILL.md" },
        }],
      },
    })
    renderOverlay()

    fireEvent.click(await screen.findByRole("button", { name: "Open skill triage" }))
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: ".agents/skills/triage/SKILL.md", mode: "view" },
    }))
  })

  it("never renders non-invocable (policy-hidden) skills", async () => {
    respond({
      skills: {
        skills: [
          { name: "visible", resource: { filesystem: "user", path: "skills/visible/SKILL.md" } },
          { name: "hidden", invocable: false, resource: { filesystem: "user", path: "skills/hidden/SKILL.md" } },
        ],
      },
    })
    renderOverlay()

    expect(await screen.findByText("/visible")).toBeInTheDocument()
    expect(screen.queryByText("/hidden")).not.toBeInTheDocument()
    expect(screen.queryByText("hidden")).not.toBeInTheDocument()
  })

  it("shows quiet empty states without jargon", async () => {
    respond({})
    render(
      <AgentDetailsOverlay
        agent={{ agentTypeId: "empty", label: "Empty" }}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText("No skills.")).toBeInTheDocument()
    expect(screen.getByText("No tools.")).toBeInTheDocument()
    expect(screen.getByText("No MCP servers connected.")).toBeInTheDocument()
    expect(screen.getByText("No plugins.")).toBeInTheDocument()
  })

  it("lists persona instructions and workspace instructions as openable rows", async () => {
    respond({
      // The seat directory ("desk-7") is deliberately NOT derivable from the
      // agent id ("concierge"): the overlay must render what /describe reports
      // instead of inverting a mapping only the Host owns.
      describe: {
        mcpServers: [],
        instructionFiles: [{ filesystem: "user", path: ".agents/personas/desk-7/instructions.md", role: "persona" }],
      },
      rootTree: { entries: [
        { name: "AGENTS.md", kind: "file", path: "AGENTS.md" },
        { name: ".agents", kind: "dir", path: ".agents" },
      ] },
    })
    renderOverlay()

    fireEvent.click(await screen.findByRole("button", { name: "Open Persona instructions" }))
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: ".agents/personas/desk-7/instructions.md", mode: "view" },
    }))
    fireEvent.click(screen.getByRole("button", { name: "Open AGENTS.md" }))
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: "AGENTS.md", mode: "view" },
    }))
    expect(screen.queryByText("CLAUDE.md")).not.toBeInTheDocument()
  })

  it("never asks for the workspace filesystem catalog", async () => {
    respond({})
    renderOverlay()

    expect(await screen.findByText("No skills.")).toBeInTheDocument()
    expect(mocks.getJson.mock.calls.some(([path]) => (path as string).startsWith("/api/v1/filesystems"))).toBe(false)
  })

  it("renders a failed workspace-root listing as an error, not as no instruction files", async () => {
    respond({
      describe: {
        mcpServers: [],
        instructionFiles: [{ filesystem: "user", path: "personas/a/instructions.md", role: "persona" }],
      },
      rootTree: new Error("network failed"),
    })
    renderOverlay()

    expect(await screen.findByText("Instructions couldn't be fully loaded.")).toBeInTheDocument()
    expect(screen.queryByText("No instruction files.")).not.toBeInTheDocument()
    expect(screen.getByText("Persona instructions")).toBeInTheDocument()
  })
  it("surfaces a well-formed instruction ref whose file does not exist, instead of 404-ing silently", async () => {
    respond({
      describe: {
        mcpServers: [],
        // Passes `openableFileResource` cleanly — the failure mode this covers
        // is a HEALTHY-looking ref addressing a file the served filesystem does
        // not have (personas ship in the app image; `user` serves the workspace).
        instructionFiles: [{ filesystem: "user", path: ".agents/personas/triage/instructions.md", role: "persona" }],
      },
      existingFiles: [],
    })
    renderOverlay()

    fireEvent.click(await screen.findByRole("button", { name: "Open Persona instructions" }))

    // Never a silent no-op: the user is told, by path.
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "showNotification",
      params: {
        msg: "Persona instructions isn't in this workspace (.agents/personas/triage/instructions.md).",
        level: "error",
      },
    }))
    // …and no openFile was dispatched into a viewer that would 404 in silence.
    expect(mocks.postUiCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "openFile" }))
    // The row stops pretending to be a healthy link rather than failing
    // identically on every subsequent click.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open Persona instructions" })).not.toBeInTheDocument())
    expect(screen.getByText("unavailable")).toBeInTheDocument()
    expect(screen.getByText(/was not found/)).toBeInTheDocument()
  })

  it("degrades a skill row whose file is missing without touching its siblings", async () => {
    respond({
      skills: {
        skills: [
          { name: "here", resource: { filesystem: "user", path: "skills/here/SKILL.md" } },
          { name: "gone", resource: { filesystem: "user", path: "skills/gone/SKILL.md" } },
        ],
      },
      existingFiles: ["skills/here/SKILL.md"],
    })
    renderOverlay()

    fireEvent.click(await screen.findByRole("button", { name: "Open skill gone" }))
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open skill gone" })).not.toBeInTheDocument())
    expect(mocks.postUiCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "openFile" }))

    // Only the row that failed degrades.
    fireEvent.click(screen.getByRole("button", { name: "Open skill here" }))
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: "skills/here/SKILL.md", mode: "view" },
    }))
  })

  it("does not permanently degrade a row when its existence probe has a transient failure", async () => {
    respond({
      skills: {
        skills: [{ name: "retry", resource: { filesystem: "user", path: "skills/retry/SKILL.md" } }],
      },
      probeErrors: [Object.assign(new Error("server failed"), { status: 500 })],
    })
    renderOverlay()

    const row = await screen.findByRole("button", { name: "Open skill retry" })
    fireEvent.click(row)
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "showNotification",
      params: {
        msg: "/retry couldn't be checked right now (skills/retry/SKILL.md). Try again.",
        level: "error",
      },
    }))
    expect(screen.getByRole("button", { name: "Open skill retry" })).toBeInTheDocument()
    expect(screen.queryByText("unavailable")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open skill retry" }))
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: "skills/retry/SKILL.md", mode: "view" },
    }))
  })

  it("refuses to open an instruction ref the path guard rejects", async () => {
    respond({
      describe: {
        mcpServers: [],
        // A hostile/malformed ref must not become a clickable openFile.
        instructionFiles: [{ filesystem: "user", path: "../../etc/passwd", role: "persona" }],
      },
    })
    renderOverlay()

    // The row still renders (the operator sees the agent HAS persona
    // instructions) but it is inert, exactly like an unopenable skill.
    expect(await screen.findByText("Persona instructions")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open Persona instructions" })).not.toBeInTheDocument()
    expect(mocks.postUiCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "openFile" }))
  })

  it("does not let a slow response for the previous agent land on the current one", async () => {
    const pending = new Map<string, (value: unknown) => void>()
    mocks.getJson.mockImplementation((path: string) => {
      if (path.includes("/agents/slow/")) {
        return new Promise((resolve) => pending.set(path, resolve))
      }
      if (path.endsWith("/describe")) return Promise.resolve({ mcpServers: [] })
      if (path.endsWith("/skills")) return Promise.resolve({ skills: [{ name: "fast-skill" }] })
      if (path.endsWith("/tools")) return Promise.resolve({ tools: [] })
      if (path.endsWith("/models")) return Promise.resolve({ models: [] })
      return Promise.resolve({ entries: [] })
    })
    const { rerender } = render(
      <AgentDetailsOverlay agent={{ agentTypeId: "slow", label: "Slow" }} onClose={vi.fn()} />,
    )
    rerender(<AgentDetailsOverlay agent={{ agentTypeId: "fast", label: "Fast" }} onClose={vi.fn()} />)
    expect(await screen.findByText("/fast-skill")).toBeInTheDocument()

    // The stale agent finally answers with a completely different skill set.
    for (const [path, resolve] of pending) {
      resolve(path.endsWith("/skills") ? { skills: [{ name: "stale-skill" }] } : {})
    }
    await waitFor(() => expect(screen.getByText("/fast-skill")).toBeInTheDocument())
    expect(screen.queryByText("/stale-skill")).not.toBeInTheDocument()
  })

  it("maps internal skill source labels to user words and hides unknown ones", async () => {
    respond({
      skills: {
        skills: [
          { name: "a", source: "temporary", resource: { filesystem: "user", path: "skills/a/SKILL.md" } },
          { name: "b", source: "@scope/pkg", resource: { filesystem: "user", path: "skills/b/SKILL.md" } },
          { name: "c", source: "mystery-enum", resource: { filesystem: "user", path: "skills/c/SKILL.md" } },
        ],
      },
    })
    renderOverlay()

    expect(await screen.findByText("/a")).toBeInTheDocument()
    expect(screen.getByText("workspace")).toBeInTheDocument()
    expect(screen.getByText("package")).toBeInTheDocument()
    expect(screen.queryByText("temporary")).not.toBeInTheDocument()
    expect(screen.queryByText("mystery-enum")).not.toBeInTheDocument()
  })

  it("surfaces per-section errors without breaking the rest of the page", async () => {
    respond({
      skills: new Error("boom"),
      describe: { mcpServers: [] },
      tools: { tools: [{ name: "run_shell" }] },
    })
    renderOverlay()

    expect(await screen.findByText("Skills couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByText("run_shell")).toBeInTheDocument()
  })

  it("reports unavailable sources without an API client, keeping list plugin ids", async () => {
    mocks.client = null
    renderOverlay()

    expect(await screen.findByText("Skills couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByText("Instructions couldn't be fully loaded.")).toBeInTheDocument()
    expect(screen.getByText("ask-user")).toBeInTheDocument()
    await waitFor(() => expect(mocks.getJson).not.toHaveBeenCalled())
  })
})
