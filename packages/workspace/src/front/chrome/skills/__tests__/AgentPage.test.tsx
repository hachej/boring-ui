import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AgentPage } from "../AgentPage"

const mocks = vi.hoisted(() => {
  const getJson = vi.fn()
  return {
    getJson,
    client: { getJson, agentTypeId: "default" },
    postUiCommand: vi.fn(),
  }
})

vi.mock("../../../plugin/useWorkspacePluginClient", () => ({
  useWorkspacePluginClient: () => mocks.client,
}))

vi.mock("../../../bridge", () => ({
  postUiCommand: mocks.postUiCommand,
}))

const skills = [
  {
    name: "workspace-skill",
    description: "Workspace source.",
    source: "project",
    resource: { filesystem: "user", path: ".agents/skills/workspace-skill/SKILL.md" },
  },
  {
    name: "duplicate",
    description: "Package management source.",
    source: "@example/package",
    invocable: false,
    resource: { filesystem: "agent_resources", path: "packages/@example/package/skills/duplicate/SKILL.md" },
  },
  {
    name: "duplicate",
    description: "Shared management source.",
    source: "shared/pi-agent",
    invocable: false,
    resource: { filesystem: "agent_resources", path: "shared/pi-agent/duplicate/SKILL.md" },
  },
]

/** Route the two fan-out requests to their own payloads. */
function respondWith({ skills: skillsPayload, tools: toolsPayload }: {
  skills?: unknown
  tools?: unknown
}) {
  mocks.getJson.mockImplementation(async (path: string) => {
    if (path.includes("/tools")) return toolsPayload ?? { tools: [] }
    return skillsPayload ?? { skills: [] }
  })
}

describe("AgentPage skills section", () => {
  beforeEach(() => {
    mocks.getJson.mockReset()
    mocks.postUiCommand.mockReset()
    respondWith({ skills: { skills } })
  })

  it("preserves filesystem identity when opening workspace, package, and shared sources", async () => {
    render(<AgentPage />)

    await screen.findByText("/workspace-skill")
    expect(await screen.findAllByText("Management source")).toHaveLength(2)
    expect(screen.queryByText("/duplicate")).not.toBeInTheDocument()
    expect(screen.getByText("Source: @example/package")).toBeInTheDocument()
    expect(screen.getByText("Source: shared/pi-agent")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open skill workspace-skill from project" }))
    fireEvent.click(screen.getByRole("button", { name: "Open management source duplicate from @example/package" }))
    fireEvent.click(screen.getByRole("button", { name: "Open management source duplicate from shared/pi-agent" }))

    expect(mocks.postUiCommand.mock.calls.map(([command]) => command)).toEqual([
      {
        kind: "openFile",
        params: { path: ".agents/skills/workspace-skill/SKILL.md", filesystem: "user", mode: "view" },
      },
      {
        kind: "openFile",
        params: { path: "packages/@example/package/skills/duplicate/SKILL.md", filesystem: "agent_resources", mode: "view" },
      },
      {
        kind: "openFile",
        params: { path: "shared/pi-agent/duplicate/SKILL.md", filesystem: "agent_resources", mode: "view" },
      },
    ])
  })

  it("keeps resource-less same-name rows reconciliation-safe", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    respondWith({ skills: { skills: [
      { name: "duplicate", source: "first", description: "First." },
      { name: "duplicate", source: "second", description: "Second." },
    ] } })
    render(<AgentPage />)
    expect(await screen.findAllByText("/duplicate")).toHaveLength(2)
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/i)
    consoleError.mockRestore()
  })

  it("rejects unsafe resource locators without leaking them into the DOM", async () => {
    const invalidPaths = [
      "/home/operator/private/SKILL.md",
      "../secret/SKILL.md",
      "skills/%2e%2e/secret/SKILL.md",
    ]
    respondWith({ skills: { skills: invalidPaths.map((path, index) => ({
      name: `invalid-${index}`,
      resource: { filesystem: "agent_resources", path },
    })) } })
    const { container } = render(<AgentPage />)

    await screen.findByText("/invalid-0")
    for (let index = 0; index < invalidPaths.length; index++) {
      expect(screen.queryByRole("button", { name: new RegExp(`invalid-${index}`) })).not.toBeInTheDocument()
    }
    for (const path of invalidPaths) expect(container.textContent).not.toContain(path)
    expect(mocks.postUiCommand).not.toHaveBeenCalled()
  })

  it("exposes clear accessible labels and refreshes both sections through the guarded endpoints", async () => {
    render(<AgentPage onClose={vi.fn()} />)
    await screen.findByText("/workspace-skill")

    expect(screen.getByRole("button", { name: "Open skill workspace-skill from project" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Refresh agent" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Close agent" })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Refresh agent" }))
    await waitFor(() => expect(mocks.getJson).toHaveBeenCalledWith(
      "/api/v1/agents/default/skills?refresh=1",
      expect.objectContaining({ missingMessage: expect.any(String) }),
    ))
    expect(mocks.getJson).toHaveBeenCalledWith(
      "/api/v1/agents/default/tools?refresh=1",
      expect.objectContaining({ missingMessage: expect.any(String) }),
    )
  })

  it("describes the surface as skills and tools in the header", async () => {
    respondWith({ skills: { skills: [{ name: "alpha" }] } })
    render(<AgentPage />)
    await screen.findByText("Skills and tools available to this agent")
  })

  it("shows a skills alert with a retry action and no empty state when skills fail to load", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getJson.mockImplementation(async (path: string) => {
      if (path.includes("/tools")) return { tools: [] }
      throw new Error("boom")
    })
    render(<AgentPage />)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("boom")
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy()
    expect(screen.queryByText(/No skills\./)).toBeNull()

    respondWith({ skills: { skills: [{ name: "alpha" }] } })
    within(alert).getByRole("button", { name: "Retry" }).click()
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    consoleError.mockRestore()
  })

  it("shows the empty state when there are no skills", async () => {
    respondWith({ skills: { skills: [] } })
    render(<AgentPage />)
    await screen.findByText(/No skills\./)
  })
})

describe("AgentPage tools section", () => {
  beforeEach(() => {
    mocks.getJson.mockReset()
    mocks.postUiCommand.mockReset()
  })

  it("lists the agent's tools from the per-agent tools route", async () => {
    respondWith({
      skills: { skills: [] },
      tools: { tools: [
        { name: "read_file", description: "Read a file from the workspace." },
        { name: "write_file" },
      ] },
    })
    render(<AgentPage />)

    await screen.findByText("read_file")
    expect(screen.getByText("write_file")).toBeInTheDocument()
    expect(mocks.getJson).toHaveBeenCalledWith(
      "/api/v1/agents/default/tools",
      expect.objectContaining({ missingMessage: expect.any(String) }),
    )
  })

  it("expands a tool description on click", async () => {
    respondWith({
      skills: { skills: [] },
      tools: { tools: [{ name: "read_file", description: "Read a file from the workspace." }] },
    })
    render(<AgentPage />)

    const toggle = await screen.findByRole("button", { name: /read_file/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
  })

  it("shows a tools alert when the tools route fails, without hiding skills", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getJson.mockImplementation(async (path: string) => {
      if (path.includes("/tools")) throw new Error("tools down")
      return { skills: [{ name: "alpha" }] }
    })
    render(<AgentPage />)

    await screen.findByText("/alpha")
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("tools down")
    consoleError.mockRestore()
  })
})
