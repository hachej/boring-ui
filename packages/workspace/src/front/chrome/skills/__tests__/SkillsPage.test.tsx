import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { SkillsPage } from "../SkillsPage"

const getJson = vi.fn()

// Stable identity: SkillsPage keys its load effect off the client object, and
// the real provider memoises it.
const client = { agentTypeId: "agent", getJson }

vi.mock("../../../plugin/useWorkspacePluginClient", () => ({
  useWorkspacePluginClient: () => client,
}))

vi.mock("../../../bridge", () => ({ postUiCommand: vi.fn() }))

describe("SkillsPage", () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it("renders openable skills as buttons and non-openable skills as static rows", async () => {
    getJson.mockResolvedValue({
      skills: [
        { name: "alpha", description: "Alpha skill", source: "workspace", filePath: "/skills/alpha/SKILL.md" },
        { name: "beta", description: "Beta skill" },
      ],
    })

    render(<SkillsPage />)

    await screen.findByRole("button", { name: "Open skill alpha in workspace" })
    expect(screen.queryByRole("button", { name: /beta/ })).toBeNull()
    expect(screen.getByText("/beta")).toBeTruthy()
    expect(screen.getByText("workspace")).toBeTruthy()
  })

  it("summarises the skill count in the header description", async () => {
    getJson.mockResolvedValue({ skills: [{ name: "alpha" }] })
    render(<SkillsPage />)
    await screen.findByText("1 skill available to slash commands")
  })

  it("shows an alert with a retry action and no empty state when loading fails", async () => {
    getJson.mockRejectedValue(new Error("boom"))
    render(<SkillsPage />)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("boom")
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
    expect(screen.queryByText("No skills found")).toBeNull()

    getJson.mockResolvedValue({ skills: [{ name: "alpha", filePath: "/a/SKILL.md" }] })
    screen.getByRole("button", { name: "Retry" }).click()
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("shows the empty state when there are no skills", async () => {
    getJson.mockResolvedValue({ skills: [] })
    render(<SkillsPage />)
    await screen.findByText("No skills found")
  })
})
