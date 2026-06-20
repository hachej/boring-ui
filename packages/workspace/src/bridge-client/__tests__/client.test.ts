import { describe, expect, test, vi } from "vitest"
import {
  WORKSPACE_BRIDGE_TOKEN_ENV,
  WORKSPACE_BRIDGE_URL_ENV,
  WorkspaceBridgeClient,
  WorkspaceBridgeClientConfigError,
  WorkspaceBridgeClientError,
} from ".."

function makeFetch(response: unknown, init: { status?: number } = {}) {
  return vi.fn(async () => ({
    status: init.status ?? 200,
    json: async () => response,
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>
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
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/v1/workspace-bridge/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-token",
      },
      body: JSON.stringify({ op: "example.v1.records.read", input: { seriesId: "GDPC1" }, requestId: "req-1" }),
    })
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

  test("maps stable bridge errors", async () => {
    const fetchMock = makeFetch({
      ok: false,
      requestId: "req-error",
      error: { code: "BRIDGE_CAPABILITY_DENIED", message: "denied" },
    }, { status: 403 })
    const client = new WorkspaceBridgeClient({
      url: "https://example.test/api/v1/workspace-bridge/call",
      token: "secret-token",
      fetch: fetchMock,
    })

    await expect(client.call("example.v1.records.read", {})).rejects.toMatchObject({
      name: "WorkspaceBridgeClientError",
      code: "BRIDGE_CAPABILITY_DENIED",
      status: 403,
      requestId: "req-error",
      message: "denied",
    } satisfies Partial<WorkspaceBridgeClientError>)
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
