import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PluginErrorBoundary } from "../PluginErrorBoundary"
import { PluginErrorProvider, usePluginErrors } from "../PluginErrorContext"
import { useEffect } from "react"

function BrokenPanel(): never {
  throw new Error("boom")
}

function HealthyPanel() {
  return <div data-testid="healthy">OK</div>
}

function ErrorSpy({ onErrors }: { onErrors: (errors: unknown[]) => void }) {
  const { errors } = usePluginErrors()
  useEffect(() => {
    if (errors.length > 0) onErrors(errors)
  }, [errors, onErrors])
  return null
}

describe("PluginErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <PluginErrorProvider>
        <PluginErrorBoundary pluginId="test" contributionKind="panel">
          <HealthyPanel />
        </PluginErrorBoundary>
      </PluginErrorProvider>,
    )
    expect(screen.getByTestId("healthy")).toBeInTheDocument()
  })

  it("renders ErrorChip when child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <PluginErrorProvider>
        <PluginErrorBoundary pluginId="bad-plugin" contributionKind="panel" contributionId="my-panel">
          <BrokenPanel />
        </PluginErrorBoundary>
      </PluginErrorProvider>,
    )
    expect(screen.getByText(/\[bad-plugin\]/)).toBeInTheDocument()
    expect(screen.getByText(/panel error: boom/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it("reports error to PluginErrorContext", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const onErrors = vi.fn()
    render(
      <PluginErrorProvider>
        <ErrorSpy onErrors={onErrors} />
        <PluginErrorBoundary pluginId="broken" contributionKind="catalog-row" contributionId="row-1">
          <BrokenPanel />
        </PluginErrorBoundary>
      </PluginErrorProvider>,
    )
    expect(onErrors).toHaveBeenCalledTimes(1)
    const reported = onErrors.mock.calls[0][0]
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({
      kind: "contribution",
      pluginId: "broken",
      contributionKind: "catalog-row",
      contributionId: "row-1",
    })
    expect(reported[0].error).toBeInstanceOf(Error)
    expect(reported[0].error.message).toBe("boom")
    spy.mockRestore()
  })

  it("isolates failures — sibling boundary still renders", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <PluginErrorProvider>
        <PluginErrorBoundary pluginId="bad" contributionKind="panel">
          <BrokenPanel />
        </PluginErrorBoundary>
        <PluginErrorBoundary pluginId="good" contributionKind="panel">
          <HealthyPanel />
        </PluginErrorBoundary>
      </PluginErrorProvider>,
    )
    expect(screen.getByTestId("healthy")).toBeInTheDocument()
    expect(screen.getByText(/\[bad\]/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it("works without PluginErrorContext (no provider)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <PluginErrorBoundary pluginId="orphan" contributionKind="panel">
        <BrokenPanel />
      </PluginErrorBoundary>,
    )
    expect(screen.getByText(/\[orphan\]/)).toBeInTheDocument()
    expect(screen.getByText(/panel error: boom/)).toBeInTheDocument()
    spy.mockRestore()
  })
})
