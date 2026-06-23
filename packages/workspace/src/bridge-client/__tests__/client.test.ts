import { describe, expect, test, vi } from "vitest"
import {
  WORKSPACE_BRIDGE_TOKEN_ENV,
  WORKSPACE_BRIDGE_URL_ENV,
  WorkspaceBridgeClient,
  WorkspaceBridgeClientConfigError,
  WorkspaceBridgeClientError,
  WorkspaceBridgeClientErrorCode,
  WorkspaceBridgeErrorCode,
} from ".."

function makeFetch(response: unknown, init: { status?: number; ok?: boolean; statusText?: string } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? ((init.status ?? 200) >= 200 && (init.status ?? 200) < 300),
    status: init.status ?? 200,
    statusText: init.statusText ?? "",
    json: async () => response,
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

function makeSequenceFetch(responses: Array<{ body: unknown; status?: number; ok?: boolean }>) {
  return vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error("unexpected fetch call")
    return {
      ok: next.ok ?? ((next.status ?? 200) >= 200 && (next.status ?? 200) < 300),
      status: next.status ?? 200,
      json: async () => next.body,
    }
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe("WorkspaceBridgeClient", () => {
  test("reads env and sends bridge call with bearer token", async () => {
    const fetchMock = makeFetch({ ok: true, output: { value: 42 }, requestId: "req-1" })
    const client = WorkspaceBridgeClient.fromEnv({
      BORING_WORKSPACE_BRIDGE_URL: "https://example.test/api/v1/workspace-bridge/call",
      BORING_WORKSPACE_BRIDGE_TOKEN: "secret-token",
    }, { fetch: fetchMock })

    const output = await client.call("example.v1.records.read", { seriesId: "GDPC1" }, { requestId: "req-1" })

    expect(output).toEqual({ value: 42 })
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/v1/workspace-bridge/call", expect.objectContaining({
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-token",
      },
      body: JSON.stringify({ op: "example.v1.records.read", input: { seriesId: "GDPC1" }, requestId: "req-1" }),
      signal: expect.any(AbortSignal),
    }))
  })

  test("serializes idempotencyKey", async () => {
    const fetchMock = makeFetch({ ok: true, output: { persisted: true } })
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })

    await client.call("example.v1.records.write", { id: "t1" }, {
      idempotencyKey: "idem-1",
    })

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toEqual({
      op: "example.v1.records.write",
      input: { id: "t1" },
      idempotencyKey: "idem-1",
    })
  })

  test("maps stable bridge errors and exports bridge error codes", async () => {
    const fetchMock = makeFetch({
      ok: false,
      requestId: "req-error",
      error: { code: WorkspaceBridgeErrorCode.CapabilityDenied, message: "denied" },
    }, { status: 403 })
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      name: "WorkspaceBridgeClientError",
      code: WorkspaceBridgeErrorCode.CapabilityDenied,
      status: 403,
      requestId: "req-error",
      message: "denied",
    } satisfies Partial<WorkspaceBridgeClientError>)
  })

  test("supports token providers and retries once after a 401 bridge auth error", async () => {
    const fetchMock = makeSequenceFetch([
      {
        status: 401,
        body: { ok: false, error: { code: WorkspaceBridgeErrorCode.ExpiredToken, message: "expired" }, requestId: "req-1" },
      },
      { status: 200, body: { ok: true, output: { value: "ok" }, requestId: "req-1" } },
    ])
    const tokenProvider = vi.fn(async ({ refresh }: { refresh: boolean }) => refresh ? "fresh-token" : "expired-token")
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: tokenProvider,
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).resolves.toEqual({ value: "ok" })
    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(tokenProvider).toHaveBeenNthCalledWith(1, { refresh: false })
    expect(tokenProvider).toHaveBeenNthCalledWith(2, { refresh: true })
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer expired-token" })
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer fresh-token" })
  })

  test("applies timeoutMs to token provider resolution", async () => {
    const fetchMock = makeFetch({ ok: true, output: { value: "unused" } })
    const tokenProvider = vi.fn(() => new Promise<string>(() => {}))
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: tokenProvider,
      fetch: fetchMock,
      defaultTimeoutMs: 1,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.Timeout,
    })
    expect(tokenProvider).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does not retry static expired tokens", async () => {
    const fetchMock = makeFetch({
      ok: false,
      error: { code: WorkspaceBridgeErrorCode.ExpiredToken, message: "expired" },
    }, { status: 401 })
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "expired-token",
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeErrorCode.ExpiredToken,
      status: 401,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("wraps gateway JSON without a bridge envelope as a stable HTTP error", async () => {
    const fetchMock = makeFetch({ message: "bad gateway" }, { status: 502, ok: false })
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.HttpError,
      status: 502,
      message: "bad gateway",
    })
  })

  test("rejects invalid success envelopes with a stable client code", async () => {
    const fetchMock = makeFetch({ ok: "yes", output: 1 })
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.InvalidResponse,
      status: 200,
    })
  })

  test("wraps fetch failures as stable transport errors", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("ECONNRESET") }) as unknown as typeof fetch
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.Transport,
    })
  })

  test("supports AbortSignal", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.dispatchEvent(new Event("abort"))
      throw new DOMException("aborted", "AbortError")
    }) as unknown as typeof fetch
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })
    const controller = new AbortController()
    controller.abort()

    await expect(client.call("example.v1.records.read", {}, { signal: controller.signal })).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.Aborted,
    })
  })

  test("times out stalled requests", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
    })) as unknown as typeof fetch
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
      defaultTimeoutMs: 1,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.Timeout,
    })
  })

  test("times out stalled response bodies after headers arrive", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
      }),
    })) as unknown as typeof fetch
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
      defaultTimeoutMs: 1,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      code: WorkspaceBridgeClientErrorCode.Timeout,
    })
  })

  test("missing env names the missing var without leaking token", () => {
    expect(() => WorkspaceBridgeClient.fromEnv({
      BORING_WORKSPACE_BRIDGE_URL: "https://example.test/api/v1/workspace-bridge/call",
    }, { fetch: makeFetch({ ok: true, output: null }) })).toThrowError(WorkspaceBridgeClientConfigError)

    try {
      WorkspaceBridgeClient.fromEnv({
        BORING_WORKSPACE_BRIDGE_URL: "https://example.test/api/v1/workspace-bridge/call",
      }, { fetch: makeFetch({ ok: true, output: null }) })
    } catch (error) {
      expect(error).toMatchObject({ missingVar: WORKSPACE_BRIDGE_TOKEN_ENV })
      expect(String(error)).toContain(WORKSPACE_BRIDGE_TOKEN_ENV)
      expect(String(error)).not.toContain("secret-token")
    }
  })

  test("invalid URL error names URL env var without leaking token", () => {
    expect(() => WorkspaceBridgeClient.fromEnv({
      BORING_WORKSPACE_BRIDGE_URL: "not a url",
      BORING_WORKSPACE_BRIDGE_TOKEN: "secret-token",
    }, { fetch: makeFetch({ ok: true, output: null }) })).toThrowError(WorkspaceBridgeClientConfigError)

    try {
      WorkspaceBridgeClient.fromEnv({
        BORING_WORKSPACE_BRIDGE_URL: "not a url",
        BORING_WORKSPACE_BRIDGE_TOKEN: "secret-token",
      }, { fetch: makeFetch({ ok: true, output: null }) })
    } catch (error) {
      expect(String(error)).toContain(WORKSPACE_BRIDGE_URL_ENV)
      expect(String(error)).not.toContain("secret-token")
    }
  })

  test("disabled env throws stable config error without token", () => {
    expect(() => WorkspaceBridgeClient.fromEnv({
      BORING_WORKSPACE_BRIDGE_DISABLED: "remote-bridge-url-must-be-https",
      BORING_WORKSPACE_BRIDGE_TOKEN: "secret-token",
    }, { fetch: makeFetch({ ok: true, output: null }) })).toThrowError(/remote-bridge-url-must-be-https/)
  })
})
