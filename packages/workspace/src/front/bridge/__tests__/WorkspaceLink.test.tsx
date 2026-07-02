import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"
import { UI_COMMAND_EVENT } from "../uiCommandBus"
import { WorkspaceLink, workspaceLinkCommand, workspaceLinkHref } from "../WorkspaceLink"

describe("workspaceLinkCommand", () => {
  test("maps openFile targets to canonical UI commands", () => {
    expect(workspaceLinkCommand({ kind: "openFile", path: "src/app.ts", mode: "edit" })).toEqual({
      kind: "openFile",
      params: { path: "src/app.ts", mode: "edit" },
    })
    expect(workspaceLinkCommand({ kind: "openFile", path: "/company/hr/policy.md", filesystem: "company_context" })).toEqual({
      kind: "openFile",
      params: { path: "/company/hr/policy.md", filesystem: "company_context" },
    })
  })

  test("maps openSurface targets to canonical UI commands", () => {
    expect(workspaceLinkCommand({ kind: "openSurface", surfaceKind: "niche", target: "climate", meta: { source: "test" } })).toEqual({
      kind: "openSurface",
      params: { kind: "niche", target: "climate", meta: { source: "test" } },
    })
    expect(workspaceLinkCommand({ kind: "openSurface", surfaceKind: "workspace.open.path", target: "/company/hr/policy.md", filesystem: "company_context" })).toEqual({
      kind: "openSurface",
      params: { kind: "workspace.open.path", target: "/company/hr/policy.md", filesystem: "company_context" },
    })
  })

  test("maps openPanel targets to canonical UI commands", () => {
    expect(workspaceLinkCommand({ kind: "openPanel", id: "detail:1", component: "detail-pane", title: "Detail", params: { id: 1 } })).toEqual({
      kind: "openPanel",
      params: { id: "detail:1", component: "detail-pane", title: "Detail", params: { id: 1 } },
    })
  })

  test("maps expandToFile targets to canonical UI commands", () => {
    expect(workspaceLinkCommand({ kind: "expandToFile", path: "src/app.ts" })).toEqual({
      kind: "expandToFile",
      params: { path: "src/app.ts" },
    })
  })
})

describe("WorkspaceLink", () => {
  test("renders a stable command href", () => {
    render(<WorkspaceLink to={{ kind: "openFile", path: "src/app.ts" }}>Open</WorkspaceLink>)

    const link = screen.getByRole("link", { name: "Open" })
    expect(link).toHaveAttribute("href", workspaceLinkHref({ kind: "openFile", path: "src/app.ts" }))
  })

  test("dispatches UI command on unmodified primary click", async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    globalThis.addEventListener(UI_COMMAND_EVENT, handler)

    render(<WorkspaceLink to={{ kind: "openFile", path: "src/app.ts" }}>Open</WorkspaceLink>)
    await user.click(screen.getByRole("link", { name: "Open" }))

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toMatchObject({
      detail: { kind: "openFile", params: { path: "src/app.ts" } },
    })
    globalThis.removeEventListener(UI_COMMAND_EVENT, handler)
  })

  test("does not intercept modified clicks", () => {
    const handler = vi.fn()
    globalThis.addEventListener(UI_COMMAND_EVENT, handler)

    render(
      <WorkspaceLink to={{ kind: "openFile", path: "src/app.ts" }} onClick={(event) => event.preventDefault()}>
        Open
      </WorkspaceLink>,
    )
    screen.getByRole("link", { name: "Open" }).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
    )

    expect(handler).not.toHaveBeenCalled()
    globalThis.removeEventListener(UI_COMMAND_EVENT, handler)
  })
})
