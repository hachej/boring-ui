// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BoringTaskCard, BoringTaskSessionBinding } from "../shared"
import { TaskCard } from "./TaskCard"

const postJson = vi.fn()
const getJson = vi.fn()
const openDetachedChat = vi.fn()
const pluginClient = { postJson, getJson }

vi.mock("@hachej/boring-workspace", () => ({
  useWorkspacePluginClient: () => pluginClient,
}))

vi.mock("@hachej/boring-workspace/plugin", () => ({
  useWorkspaceShellCapabilities: () => ({ openArtifact: vi.fn(), openDetachedChat }),
}))

const task: BoringTaskCard = {
  id: "task-1",
  number: "#612",
  title: "Wire sessions",
  statusId: "ready",
  adapterId: "github",
}

function renderCard() {
  return render(<TaskCard task={task} draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
}

function link(overrides: Partial<BoringTaskSessionBinding> = {}): BoringTaskSessionBinding {
  return {
    id: "link-1",
    workspaceId: "workspace-a",
    adapterId: "github",
    taskId: "task-1",
    sessionId: "pi-1",
    title: "#612: Wire sessions",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  postJson.mockReset()
  getJson.mockReset()
  openDetachedChat.mockReset()
})

describe("TaskCard task chat sessions", () => {
  it("creates, binds, and opens a chat when the task has no prior session", async () => {
    postJson.mockImplementation(async (path: string, body: unknown) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [] }
      if (path === "/api/v1/agent/pi-chat/sessions") return { id: "pi-new" }
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-new", sessionId: "pi-new" }) }
      throw new Error(`unexpected post ${path} ${JSON.stringify(body)}`)
    })

    renderCard()
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/list", { adapterId: "github", taskId: "task-1" }))
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions", { title: "#612: Wire sessions" }))
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", { adapterId: "github", taskId: "task-1", sessionId: "pi-new", title: "#612: Wire sessions" })
    expect(openDetachedChat).toHaveBeenCalledWith("pi-new", expect.objectContaining({ title: "#612: Wire sessions", initialDraft: expect.stringContaining("Task ID: task-1") }))
  })

  it("shows linked sessions, reopens an available session, and unlinks", async () => {
    const existing = link()
    postJson.mockImplementation(async (path: string, body: { bindingId?: string }) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [existing] }
      if (path === "/api/boring-tasks/sessions/unlink") {
        expect(body.bindingId).toBe("link-1")
        return { ok: true }
      }
      throw new Error(`unexpected post ${path}`)
    })
    getJson.mockResolvedValue([{ id: "pi-1", title: "#612: Wire sessions" }])

    renderCard()
    expect(await screen.findByLabelText("1 linked chats")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/v1/agent/pi-chat/sessions?limit=1&activeSessionId=pi-1"))
    expect(openDetachedChat).toHaveBeenCalledWith("pi-1", expect.objectContaining({ title: "#612: Wire sessions" }))

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }))
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/unlink", { bindingId: "link-1" }))
    await waitFor(() => expect(screen.queryByText("#612: Wire sessions")).not.toBeInTheDocument())
  })

  it("links an existing standalone Pi session through search", async () => {
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [link()] }
      if (path === "/api/boring-tasks/sessions/search") return { sessions: [{ id: "pi-standalone", title: "Standalone" }] }
      if (path === "/api/boring-tasks/sessions/link") return { link: link({ id: "link-standalone", sessionId: "pi-standalone", title: "Standalone" }) }
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.change(screen.getByPlaceholderText("Search chats"), { target: { value: "standalone" } })
    fireEvent.click(screen.getByRole("button", { name: /link existing/i }))
    expect(await screen.findByText("Standalone")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Link" }))

    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", {
      adapterId: "github",
      taskId: "task-1",
      sessionId: "pi-standalone",
      title: "Standalone",
    }))
  })

  it("renders the linked-session disclosure and actions in compact cards", async () => {
    postJson.mockResolvedValue({ links: [link()] })
    getJson.mockResolvedValue([{ id: "pi-1", title: "#612: Wire sessions" }])

    render(<TaskCard task={task} compact draggable={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    expect(await screen.findByRole("region", { name: /linked chat sessions/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unlink" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /link existing/i })).toBeInTheDocument()
  })

  it("surfaces unavailable linked sessions without opening them", async () => {
    postJson.mockResolvedValue({ links: [link()] })
    getJson.mockResolvedValue([])

    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /open chat/i }))
    fireEvent.click(await screen.findByRole("button", { name: "Open" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available")
    expect(openDetachedChat).not.toHaveBeenCalled()
  })

  it("does not open an unbound chat when binding fails after creation", async () => {
    postJson.mockImplementation(async (path: string) => {
      if (path === "/api/boring-tasks/sessions/list") return { links: [] }
      if (path === "/api/v1/agent/pi-chat/sessions") return { id: "pi-orphan" }
      if (path === "/api/boring-tasks/sessions/link") throw new Error("binding failed")
      throw new Error(`unexpected post ${path}`)
    })

    renderCard()
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/list", { adapterId: "github", taskId: "task-1" }))
    fireEvent.click(screen.getByRole("button", { name: /open chat/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Created chat pi-orphan")
    expect(openDetachedChat).not.toHaveBeenCalled()
  })
})
