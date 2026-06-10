/* @vitest-environment jsdom */
import { act, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { CommandRunStatus } from "../CommandRunStatus"

let roots: Array<ReturnType<typeof createRoot>> = []
let containers: HTMLElement[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function render(ui: ReactElement): HTMLElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => {
    root.render(ui)
  })
  return container
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  for (const container of containers) container.remove()
  roots = []
  containers = []
  vi.useRealTimers()
})

describe("CommandRunStatus", () => {
  test("running banner names the command", () => {
    const container = render(
      <CommandRunStatus state={{ kind: "running", command: "open-demo-cmd" }} onDismiss={vi.fn()} />,
    )
    const banner = container.querySelector('[data-boring-command-run="running"]')
    expect(banner?.textContent).toContain("Running")
    expect(banner?.textContent).toContain("/open-demo-cmd")
  })

  test("success banner shows the detail and auto-dismisses", () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const container = render(
      <CommandRunStatus
        state={{ kind: "success", command: "open-demo-cmd", detail: "ran in 12ms" }}
        onDismiss={onDismiss}
        successAutoDismissMs={1400}
      />,
    )
    const banner = container.querySelector('[data-boring-command-run="success"]')
    expect(banner?.textContent).toContain("Ran")
    expect(banner?.textContent).toContain("/open-demo-cmd")
    expect(banner?.textContent).toContain("ran in 12ms")
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1400)
    })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  test("error banner shows the message and does not auto-dismiss", () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const container = render(
      <CommandRunStatus
        state={{ kind: "error", command: "open-demo-cmd", message: "boom" }}
        onDismiss={onDismiss}
      />,
    )
    const banner = container.querySelector('[data-boring-command-run="error"]')
    expect(banner?.textContent).toContain("/open-demo-cmd")
    expect(banner?.textContent).toContain("boom")
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
