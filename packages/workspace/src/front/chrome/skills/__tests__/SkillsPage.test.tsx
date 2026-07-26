import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SkillsPage } from "../SkillsPage"

const mocks = vi.hoisted(() => {
  const getJson = vi.fn()
  return {
    getJson,
    client: { getJson },
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
  {
    name: "legacy-safe",
    description: "Legacy workspace locator.",
    filePath: ".pi/skills/legacy-safe/SKILL.md",
  },
  {
    name: "legacy-host-path",
    description: "Must not become openable.",
    filePath: "/home/operator/.pi/agent/skills/private/SKILL.md",
  },
]

describe("SkillsPage resource rows", () => {
  beforeEach(() => {
    mocks.getJson.mockReset()
    mocks.postUiCommand.mockReset()
    mocks.getJson.mockResolvedValue({ skills })
  })

  it("preserves filesystem identity when opening workspace, package, shared, and safe legacy sources", async () => {
    render(<SkillsPage />)

    await screen.findByText("/workspace-skill")
    fireEvent.click(screen.getByRole("button", { name: "Open skill workspace-skill from project" }))
    fireEvent.click(screen.getByRole("button", { name: "Open management source duplicate from @example/package" }))
    fireEvent.click(screen.getByRole("button", { name: "Open management source duplicate from shared/pi-agent" }))
    fireEvent.click(screen.getByRole("button", { name: "Open skill legacy-safe from user" }))

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
      {
        kind: "openFile",
        params: { path: ".pi/skills/legacy-safe/SKILL.md", filesystem: "user", mode: "view" },
      },
    ])
  })

  it("keeps same-name management identities distinct without presenting slash commands", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    render(<SkillsPage />)

    const badges = await screen.findAllByText("Management source")
    expect(badges).toHaveLength(2)
    expect(screen.getAllByText("duplicate")).toHaveLength(2)
    expect(screen.queryByText("/duplicate")).not.toBeInTheDocument()
    expect(screen.getByText("Source: @example/package")).toBeInTheDocument()
    expect(screen.getByText("Source: shared/pi-agent")).toBeInTheDocument()

    const rows = screen.getAllByRole("listitem")
    const duplicateRows = rows.filter((row) => within(row).queryByText("duplicate"))
    expect(duplicateRows).toHaveLength(2)
    expect(duplicateRows[0]).toHaveTextContent("Package management source.")
    expect(duplicateRows[1]).toHaveTextContent("Shared management source.")
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/i)
    consoleError.mockRestore()
  })

  it("rejects absolute and traversal legacy locators without leaking them into the DOM", async () => {
    mocks.getJson.mockResolvedValue({
      skills: [
        skills[4],
        { name: "traversal", filePath: "../secret/SKILL.md" },
        { name: "encoded", filePath: "skills/%2e%2e/secret/SKILL.md" },
        { name: "backslash", filePath: "skills\\evil\\SKILL.md" },
        { name: "drive", filePath: "C:/skills/SKILL.md" },
        { name: "scheme", filePath: "file:///etc/passwd" },
        {
          name: "invalid-resource",
          resource: { filesystem: "agent_resources", path: "../secret/SKILL.md" },
          filePath: ".pi/skills/must-not-fallback/SKILL.md",
        },
      ],
    })
    const { container } = render(<SkillsPage />)

    await screen.findByText("/legacy-host-path")
    expect(screen.queryByRole("button", { name: /legacy-host-path/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /traversal/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /encoded/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /backslash/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /drive/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /scheme/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /invalid-resource/ })).not.toBeInTheDocument()
    expect(container.textContent).not.toContain("/home/operator")
    expect(container.textContent).not.toContain("../secret")
    expect(mocks.postUiCommand).not.toHaveBeenCalled()
  })

  it("exposes clear accessible labels and refreshes through the guarded endpoint", async () => {
    render(<SkillsPage onClose={vi.fn()} />)
    await screen.findByText("/workspace-skill")

    expect(screen.getByRole("button", { name: "Open skill workspace-skill from project" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Open management source duplicate from @example/package" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Refresh skills" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Close skills" })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Refresh skills" }))
    await waitFor(() => expect(mocks.getJson).toHaveBeenCalledWith(
      "/api/v1/agent/skills?refresh=1",
      expect.objectContaining({ missingMessage: expect.any(String) }),
    ))
  })
})
