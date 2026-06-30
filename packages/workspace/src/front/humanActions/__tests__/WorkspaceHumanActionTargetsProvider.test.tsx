import { useEffect } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  WorkspaceHumanActionTargetButtons,
  WorkspaceHumanActionTargetsProvider,
  useWorkspaceHumanActionTargets,
  workspaceHumanActionTargetKey,
  type WorkspaceHumanActionTargetAction,
} from "../WorkspaceHumanActionTargetsProvider"
import { clearToasts, getActiveToasts } from "../../toast"

function RegisterAction({ action }: { action: WorkspaceHumanActionTargetAction }) {
  const { registerTargetAction } = useWorkspaceHumanActionTargets()
  useEffect(() => registerTargetAction(action), [action, registerTargetAction])
  return null
}

describe("WorkspaceHumanActionTargetsProvider", () => {
  beforeEach(() => clearToasts())

  it("keys targets without storing raw content", () => {
    expect(workspaceHumanActionTargetKey({ type: "file", workspaceId: "w1", path: "README.md", label: "Readme" })).toBe("file:w1:README.md")
    expect(workspaceHumanActionTargetKey({ type: "surface", surfaceKind: "artifact", target: "html-1" })).toBe("surface:artifact:html-1")
  })

  it("renders registered target action buttons and invokes plugin callback", async () => {
    const onAction = vi.fn()
    const action: WorkspaceHumanActionTargetAction = {
      id: "review-1",
      title: "Review README",
      target: { type: "file", path: "README.md" },
      actions: [{ id: "accept", label: "Accept", tone: "positive" }],
      onAction,
    }

    render(
      <WorkspaceHumanActionTargetsProvider>
        <RegisterAction action={action} />
        <WorkspaceHumanActionTargetButtons target={{ type: "file", path: "README.md" }} />
      </WorkspaceHumanActionTargetsProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review README: Accept" }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ action: action.actions[0] }))
  })

  it("disables sibling buttons while a target action is submitting", async () => {
    let resolveSubmit!: () => void
    const onAction = vi.fn(() => new Promise<void>((resolve) => { resolveSubmit = resolve }))
    const action: WorkspaceHumanActionTargetAction = {
      id: "review-2",
      title: "Review README",
      target: { type: "file", path: "README.md" },
      actions: [
        { id: "accept", label: "Accept", tone: "positive" },
        { id: "request_changes", label: "Request changes", tone: "warning" },
      ],
      onAction,
    }

    render(
      <WorkspaceHumanActionTargetsProvider>
        <RegisterAction action={action} />
        <WorkspaceHumanActionTargetButtons target={{ type: "file", path: "README.md" }} />
      </WorkspaceHumanActionTargetsProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review README: Accept" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Review README: Request changes" })).toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: "Review README: Request changes" }))
    expect(onAction).toHaveBeenCalledTimes(1)
    resolveSubmit()
  })

  it("requires a comment before submitting comment-required actions", async () => {
    const onAction = vi.fn()
    const action: WorkspaceHumanActionTargetAction = {
      id: "review-3",
      title: "Review README",
      target: { type: "file", path: "README.md" },
      actions: [{ id: "request_changes", label: "Request changes", tone: "warning", comment: "required" }],
      onAction,
    }

    render(
      <WorkspaceHumanActionTargetsProvider>
        <RegisterAction action={action} />
        <WorkspaceHumanActionTargetButtons target={{ type: "file", path: "README.md" }} />
      </WorkspaceHumanActionTargetsProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review README: Request changes" }))
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("textbox", { name: "Request changes comment" }), { target: { value: "Needs clearer install steps" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ action: action.actions[0], comment: "Needs clearer install steps" }))
  })

  it("lets optional-comment actions submit a comment", async () => {
    const onAction = vi.fn()
    const action: WorkspaceHumanActionTargetAction = {
      id: "review-4",
      title: "Review README",
      target: { type: "file", path: "README.md" },
      actions: [{ id: "accept", label: "Accept", tone: "positive", comment: "optional" }],
      onAction,
    }

    render(
      <WorkspaceHumanActionTargetsProvider>
        <RegisterAction action={action} />
        <WorkspaceHumanActionTargetButtons target={{ type: "file", path: "README.md" }} />
      </WorkspaceHumanActionTargetsProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review README: Accept" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Accept comment" }), { target: { value: "Looks good" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ action: action.actions[0], comment: "Looks good" }))
  })

  it("surfaces target action submit failures", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("boom"))
    const action: WorkspaceHumanActionTargetAction = {
      id: "review-5",
      title: "Review README",
      target: { type: "file", path: "README.md" },
      actions: [{ id: "accept", label: "Accept", tone: "positive" }],
      onAction,
    }

    render(
      <WorkspaceHumanActionTargetsProvider>
        <RegisterAction action={action} />
        <WorkspaceHumanActionTargetButtons target={{ type: "file", path: "README.md" }} />
      </WorkspaceHumanActionTargetsProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review README: Accept" }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Decision was not submitted"))
    expect(getActiveToasts().some((toast) => toast.title === "Decision not submitted")).toBe(true)
  })
})
