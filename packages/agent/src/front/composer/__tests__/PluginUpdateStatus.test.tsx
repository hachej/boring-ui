/* @vitest-environment jsdom */
import { act, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { PluginUpdateStatus } from "../PluginUpdateStatus"

let roots: Array<ReturnType<typeof createRoot>> = []
let containers: HTMLElement[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function render(ui: ReactElement) {
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
  for (const root of roots) {
    act(() => root.unmount())
  }
  for (const container of containers) container.remove()
  roots = []
  containers = []
  vi.useRealTimers()
})

describe("PluginUpdateStatus", () => {
  test("auto-dismisses clean success banners after a short delay", () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(
      <PluginUpdateStatus
        state={{ kind: "success", reloaded: true }}
        onDismiss={onDismiss}
        onRetry={vi.fn()}
        successAutoDismissMs={2500}
      />,
    )

    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(2499)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  test("auto-dismisses success banners with browser front events", () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    const container = render(
      <PluginUpdateStatus
        state={{
          kind: "success",
          reloaded: true,
          frontEvents: [{ source: "browser", pluginId: "csv-viewer", message: "front module loaded (revision 2)" }],
        }}
        onDismiss={onDismiss}
        onRetry={vi.fn()}
        successAutoDismissMs={2500}
      />,
    )

    expect(container.textContent).toContain("Browser plugin modules updated")
    expect(container.textContent).toContain("csv-viewer")
    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  test("uses the provided max-width class so it can match the composer", () => {
    const container = render(
      <PluginUpdateStatus
        state={{ kind: "success", reloaded: true }}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        maxWidthClassName="max-w-[680px]"
      />,
    )

    expect(container.querySelector('[data-boring-plugin-update="success"]')?.className).toContain("max-w-[680px]")
  })

  test("keeps success banners with diagnostics visible until manually dismissed", () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(
      <PluginUpdateStatus
        state={{
          kind: "success",
          reloaded: true,
          diagnostics: [{ source: "plugin", message: "syntax warning" }],
        }}
        onDismiss={onDismiss}
        onRetry={vi.fn()}
        successAutoDismissMs={2500}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
