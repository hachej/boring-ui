import { Component, useEffect, type ErrorInfo, type ReactNode } from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
import { AutomationClientError } from "../client"
import { AutomationRuntimeProvider, useAutomationClient } from "../AutomationRuntimeContext"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  cleanup()
})

function ClientProbe({ onError }: { onError?: (error: unknown) => void }) {
  const client = useAutomationClient()
  useEffect(() => {
    void client.listAutomations().catch(onError)
  }, [client, onError])
  return <div>client ready</div>
}

class ErrorBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { error: Error | null }> {
  readonly state: { error: Error | null } = { error: null }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
    this.setState({ error })
  }

  render() {
    if (this.state.error) return <div>provider error</div>
    return this.props.children
  }
}

describe("AutomationRuntimeProvider", () => {
  it("threads provider api base URL, auth headers, and auth error callback into the client", async () => {
    const onAuthError = vi.fn()
    const onError = vi.fn()
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: false, code: "BORING_AUTOMATION_AUTH", error: "auth failed" }, { status: 403 }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <AutomationRuntimeProvider apiBaseUrl="https://workspace.example/" authHeaders={{ Authorization: "Bearer provider" }} onAuthError={onAuthError}>
        <ClientProbe onError={onError} />
      </AutomationRuntimeProvider>,
    )

    await waitFor(() => expect(onAuthError).toHaveBeenCalledWith(403))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }))
    expect(fetchMock).toHaveBeenCalledWith(`https://workspace.example${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer provider" }),
    }))
  })

  it("threads provider apiTimeout into the client", async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })))

    render(
      <AutomationRuntimeProvider apiBaseUrl="" apiTimeout={10}>
        <ClientProbe onError={onError} />
      </AutomationRuntimeProvider>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: "BORING_AUTOMATION_TIMEOUT",
    } satisfies Partial<AutomationClientError>))
  })

  it("fails loudly when the client hook is used without a provider", async () => {
    const onError = vi.fn()
    vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <ErrorBoundary onError={onError}>
        <ClientProbe />
      </ErrorBoundary>,
    )

    expect(await screen.findByText("provider error")).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "useAutomationClient must be used within AutomationRuntimeProvider",
    }))
  })
})
