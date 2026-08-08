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
  sessionsStatus: "loaded" as const,
}

function respond(payloads: {
  describe?: unknown
  skills?: unknown
  tools?: unknown
  models?: unknown
  filesystems?: unknown
  rootTree?: unknown
  personasTree?: unknown
}) {
  mocks.getJson!.mockImplementation(async (path: string) => {
    const table: Array<[boolean, unknown, unknown]> = [
      [path.endsWith("/describe"), payloads.describe, {}],
      [path.endsWith("/skills"), payloads.skills, { skills: [] }],
      [path.endsWith("/tools"), payloads.tools, { tools: [] }],
      [path.endsWith("/models"), payloads.models, { models: [] }],
      [path.startsWith("/api/v1/filesystems"), payloads.filesystems, { filesystems: [] }],
      [path.startsWith("/api/v1/tree") && path.includes("path=.&"), payloads.rootTree, { entries: [] }],
      [path.startsWith("/api/v1/tree"), payloads.personasTree, { entries: [] }],
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
      sessionCount={3}
      onCreateSession={vi.fn()}
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
        systemPrompt: "You are the concierge. Route work carefully.",
        plugins: [{ id: "ask-user" }, { id: "pr-review" }],
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
    expect(screen.getByText("You are the concierge. Route work carefully.")).toBeInTheDocument()
    expect(screen.getByText("read_file")).toBeInTheDocument()
    expect(screen.getByText("github")).toBeInTheDocument()
    expect(screen.getByText("2 tools")).toBeInTheDocument()
    expect(screen.getByText("create_issue, get_pr")).toBeInTheDocument()
    expect(screen.getByText("ask-user")).toBeInTheDocument()
    expect(screen.getByText("pr-review")).toBeInTheDocument()
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
      describe: { systemPrompt: null, model: "claude-fable-5", plugins: [], mcpServers: [] },
      models: { models: [{ id: "claude-fable-5", label: "Fable 5" }], defaultModel: { id: "claude-fable-5" } },
    })
    renderOverlay()

    expect(await screen.findByText("Defaults")).toBeInTheDocument()
    expect(screen.getByText("Default model")).toBeInTheDocument()
    expect(screen.getByText("Fable 5")).toBeInTheDocument()
  })

  it("falls back to the host default model label when the agent pins none", async () => {
    respond({
      describe: { systemPrompt: null, plugins: [], mcpServers: [] },
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
    expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: ".agents/skills/triage/SKILL.md", mode: "view" },
    })
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
        sessionCount={0}
        onCreateSession={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText("No skills.")).toBeInTheDocument()
    expect(screen.getByText("No tools.")).toBeInTheDocument()
    expect(screen.getByText("No MCP servers connected.")).toBeInTheDocument()
    expect(screen.getByText("No plugins.")).toBeInTheDocument()
    expect(screen.getByText("This agent uses the default instructions.")).toBeInTheDocument()
  })

  it("expands the long system prompt in place with prose-flowed text", async () => {
    const prompt = `Opening line\nthat wraps mid-sentence.\n\n${"More instructions. ".repeat(40)}End marker.`
    respond({ describe: { systemPrompt: prompt, plugins: [], mcpServers: [] } })
    renderOverlay()

    const toggle = await screen.findByRole("button", { name: "Show more" })
    // Single newlines flow as prose; paragraph breaks survive.
    const body = screen.getByText(/Opening line that wraps mid-sentence\./)
    expect(body.textContent).toContain("\n\nMore instructions.")
    // Collapsed preview clamps by lines (CSS), never by a mid-word slice.
    expect(body.className).toContain("line-clamp")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(screen.getByText(/Opening line/).className).not.toContain("line-clamp")
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument()
  })

  it("lists persona instructions, workspace instructions, and knowledge sources as openable rows", async () => {
    respond({
      rootTree: { entries: [
        { name: "AGENTS.md", kind: "file", path: "AGENTS.md" },
        { name: ".agents", kind: "dir", path: ".agents" },
      ] },
      personasTree: { entries: [
        { name: "personas", kind: "dir", path: ".agents/personas" },
        { name: "concierge", kind: "dir", path: ".agents/personas/concierge" },
      ] },
      filesystems: { filesystems: [
        { filesystem: "user", label: "Workspace", rootDir: ".", access: "readwrite" },
        { filesystem: "docs", label: "Docs", rootDir: ".", access: "readonly" },
      ] },
    })
    renderOverlay()

    fireEvent.click(await screen.findByRole("button", { name: "Open Persona instructions" }))
    expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: ".agents/personas/concierge/instructions.md", mode: "view" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Open AGENTS.md" }))
    expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: "AGENTS.md", mode: "view" },
    })
    expect(screen.queryByText("CLAUDE.md")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Browse Docs files" }))
    expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "expandToFile",
      params: { filesystem: "docs", path: "" },
    })
    expect(screen.getByText("read-only")).toBeInTheDocument()
  })

  it("materializes the composed prompt and opens it in the workbench", async () => {
    const prompt = "Prompt body.\n\n<!-- boring-skill:start name=triage digest=sha256:abc -->\n---\nname: triage\n---\n# Triage\n<!-- boring-skill:end name=triage -->"
    respond({ describe: { systemPrompt: prompt, plugins: [], mcpServers: [] } })
    mocks.postJson.mockResolvedValue({})
    renderOverlay()

    fireEvent.click(await screen.findByRole("button", { name: "Open in workbench" }))
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledWith("/api/v1/files", expect.objectContaining({
      path: ".boring/agent-prompts/concierge.md",
      filesystem: "user",
      content: expect.stringContaining("Prompt body."),
    })))
    // Generated view only: attached skill blocks render as captioned fences.
    const written = mocks.postJson.mock.calls.find((call) => call[0] === "/api/v1/files")?.[1] as { content: string }
    expect(written.content).toContain("**Attached skill: /triage**")
    expect(written.content).toContain("````text")
    expect(written.content).not.toContain("boring-skill:start")
    await waitFor(() => expect(mocks.postUiCommand).toHaveBeenCalledWith({
      kind: "openFile",
      params: { filesystem: "user", path: ".boring/agent-prompts/concierge.md", mode: "view" },
    }))
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
      describe: { systemPrompt: "Prompt.", plugins: [], mcpServers: [] },
      tools: { tools: [{ name: "run_shell" }] },
    })
    renderOverlay()

    expect(await screen.findByText("Skills couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByText("Prompt.")).toBeInTheDocument()
    expect(screen.getByText("run_shell")).toBeInTheDocument()
  })

  it("degrades to quiet states without an API client, keeping list plugin ids", async () => {
    mocks.client = null
    renderOverlay()

    expect(await screen.findByText("No skills.")).toBeInTheDocument()
    expect(screen.getByText("ask-user")).toBeInTheDocument()
    await waitFor(() => expect(mocks.getJson).not.toHaveBeenCalled())
  })
})
