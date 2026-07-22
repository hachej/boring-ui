import { afterEach, describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
import { AutomationClientError, createAutomationClient } from "../client"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("automation front client", () => {
  it("uses provider api base URL and auth headers for public routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true, automations: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createAutomationClient({ apiBaseUrl: "https://workspace.example/", headers: { Authorization: "Bearer test" } }).listAutomations()).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledWith(`https://workspace.example${BORING_AUTOMATION_ROUTE_PREFIX}/automations`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test" }),
    }))
  })

  it("updates metadata and prompt through the preserved route contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true, automation: { id: "a1", title: "Daily", enabled: true, cron: "0 9 * * *", timezone: "UTC", model: "gpt-5.5", promptRef: ".pi/automation/prompts/a1.md", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createAutomationClient()

    await client.updateAutomation("a1", { title: "Daily", enabled: false, cron: "0 10 * * *", timezone: "UTC", model: "gpt-5.5" })
    await client.updatePrompt("a1", "# Prompt", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/a1`)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ enabled: false, cron: "0 10 * * *" })
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/a1/prompt`)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      prompt: "# Prompt",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    })
  })

  it("loads a prompt with its authoritative revision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ok: true,
      prompt: "# Canonical",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })))

    await expect(createAutomationClient().getPromptSnapshot("a1")).resolves.toEqual({
      prompt: "# Canonical",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
  })

  it("runs an automation through the narrow run-now route", async () => {
    const run = { id: "r1", automationId: "a1", status: "succeeded" }
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true, run }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createAutomationClient().runNow("a1")).resolves.toEqual(run)

    expect(fetchMock).toHaveBeenCalledWith(`${BORING_AUTOMATION_ROUTE_PREFIX}/automations/a1/run`, expect.objectContaining({ method: "POST" }))
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined()
  })

  it("does not apply the short UI timeout to a long-running automation request", async () => {
    vi.useFakeTimers()
    let resolveFetch!: (response: Response) => void
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      requestSignal = (init as RequestInit).signal ?? undefined
      return new Promise<Response>((resolve) => { resolveFetch = resolve })
    }))

    const request = createAutomationClient({ apiTimeout: 25 }).runNow("a1")
    await vi.advanceTimersByTimeAsync(25)
    expect(requestSignal).toBeUndefined()

    resolveFetch(Response.json({ ok: true, run: { id: "r1" } }))
    await expect(request).resolves.toEqual({ id: "r1" })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("throws accessible route errors with server code and status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code: "BORING_AUTOMATION_NOT_FOUND", error: "missing" }, { status: 404 })))

    await expect(createAutomationClient().getPrompt("missing")).rejects.toMatchObject({
      code: "BORING_AUTOMATION_NOT_FOUND",
      message: "missing",
      statusCode: 404,
    } satisfies Partial<AutomationClientError>)
  })

  it.each([401, 403])("notifies provider auth errors for status %s", async (status) => {
    const onAuthError = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code: "BORING_AUTOMATION_AUTH", error: "auth failed" }, { status })))

    await expect(createAutomationClient({ onAuthError }).listAutomations()).rejects.toMatchObject({ statusCode: status })

    expect(onAuthError).toHaveBeenCalledWith(status)
  })

  it("times out requests with a client error and clears timeout timers", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })))

    const request = createAutomationClient({ apiTimeout: 25 }).listAutomations()
    const rejection = expect(request).rejects.toMatchObject({
      code: "BORING_AUTOMATION_TIMEOUT",
      message: "Automation request timed out after 25ms",
    } satisfies Partial<AutomationClientError>)

    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it("composes caller abort signals and cleans listeners", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, "addEventListener")
    const removeListener = vi.spyOn(controller.signal, "removeEventListener")
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, automations: [] })))

    await expect(createAutomationClient({ apiTimeout: 1000 }).listAutomations({ signal: controller.signal })).resolves.toEqual([])

    expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true })
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})
