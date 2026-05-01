import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PanelErrorBoundary } from "../PanelErrorBoundary"

function GoodChild() {
  return <div data-testid="child">ok</div>
}

let shouldThrow = false

function BombChild() {
  if (shouldThrow) throw new Error("boom")
  return <div data-testid="child">ok</div>
}

function DeepBomb() {
  return (
    <div>
      <div>
        <BombChild />
      </div>
    </div>
  )
}

let throwCount = 0

function BombOnce() {
  throwCount++
  if (throwCount <= 1) throw new Error("first render boom")
  return <div data-testid="recovered">recovered</div>
}

function AlwaysBomb() {
  throw new Error("always boom")
}

beforeEach(() => {
  shouldThrow = false
  throwCount = 0
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("PanelErrorBoundary — basic error catching", () => {
  it("renders children normally when no error thrown", () => {
    render(
      <PanelErrorBoundary panelId="test">
        <GoodChild />
      </PanelErrorBoundary>,
    )
    expect(screen.getByTestId("child")).toBeInTheDocument()
  })

  it("catches render error in child component, shows error UI", () => {
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="test">
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(screen.queryByTestId("child")).not.toBeInTheDocument()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })

  it("error UI shows panel ID", () => {
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="my-panel">
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(screen.getByText("my-panel")).toBeInTheDocument()
  })

  it("error UI shows Retry button", () => {
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="test">
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("clicking Retry resets error boundary and re-renders children", async () => {
    const user = userEvent.setup()
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="test">
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()

    shouldThrow = false
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(screen.getByTestId("child")).toBeInTheDocument()
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument()
  })

  it("if child throws again after retry, shows error UI again", async () => {
    const user = userEvent.setup()
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="test">
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })

  it("catches errors in nested children", () => {
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="test">
        <DeepBomb />
      </PanelErrorBoundary>,
    )
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })

  it("multiple error boundaries are independent", () => {
    shouldThrow = true
    render(
      <div>
        <PanelErrorBoundary panelId="a">
          <BombChild />
        </PanelErrorBoundary>
        <PanelErrorBoundary panelId="b">
          <GoodChild />
        </PanelErrorBoundary>
      </div>,
    )
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(screen.getByTestId("child")).toBeInTheDocument()
  })
})

describe("PanelErrorBoundary — error reporting", () => {
  it("onError callback called with panelId, error message, and stack", () => {
    const onError = vi.fn()
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="crash-panel" onError={onError}>
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: "crash-panel",
        error: "boom",
      }),
    )
    const call = onError.mock.calls[0][0]
    expect(typeof call.stack === "string" || call.stack === undefined).toBe(true)
  })

  it("console.error called with panel ID and error", () => {
    shouldThrow = true
    render(
      <PanelErrorBoundary panelId="err-panel">
        <BombChild />
      </PanelErrorBoundary>,
    )
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("err-panel"),
      expect.any(Error),
      expect.anything(),
    )
  })
})

describe("PanelErrorBoundary — scoping", () => {
  it("error in pane A does NOT crash pane B", () => {
    shouldThrow = true
    render(
      <div>
        <PanelErrorBoundary panelId="a">
          <BombChild />
        </PanelErrorBoundary>
        <PanelErrorBoundary panelId="b">
          <GoodChild />
        </PanelErrorBoundary>
      </div>,
    )
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(screen.getByTestId("child").textContent).toBe("ok")
  })

  it("error in pane does NOT crash workspace shell", () => {
    shouldThrow = true
    render(
      <div data-testid="shell">
        <PanelErrorBoundary panelId="bad">
          <BombChild />
        </PanelErrorBoundary>
      </div>,
    )
    expect(screen.getByTestId("shell")).toBeInTheDocument()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })
})
