import { describe, expect, it, vi } from "vitest"
import { SHAREPOINT_ERROR_CODES } from "../shared"
import { normalizeArcadeAuthState, normalizeArcadeToolAuthState } from "../server/authNormalization"
import {
  ARCADE_ENV_KEYS,
  loadArcadeSharePointRuntimeConfig,
  redactArcadeConfigForLog,
  redactArcadeSecret,
  requireArcadeSharePointRuntimeConfig,
} from "../server/arcadeConfig"
import { ArcadeJsToolRuntime } from "../server/arcadeRuntime"

describe("ArcadeJsToolRuntime", () => {
  it("wraps Arcade tool execution with the required Arcade input shape", async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, output: { value: { ok: true } } })
    const runtime = new ArcadeJsToolRuntime(
      { apiKey: "arcade-secret", defaultUserId: "user@example.com", defaultProviderId: "microsoft" },
      {
        tools: { execute },
        auth: {
          start: vi.fn(),
          status: vi.fn(),
        },
      },
    )

    await runtime.executeTool({ toolName: "MicrosoftSharepoint_GetSite", input: { site: "https://tenant.sharepoint.com/sites/test" } })

    expect(execute).toHaveBeenCalledWith({
      tool_name: "MicrosoftSharepoint_GetSite",
      user_id: "user@example.com",
      input: { site: "https://tenant.sharepoint.com/sites/test" },
    })
  })

  it("starts provider authorization with configured user/provider defaults", async () => {
    const start = vi.fn().mockResolvedValue({ status: "pending", url: "https://arcade.dev/auth" })
    const runtime = new ArcadeJsToolRuntime(
      { apiKey: "arcade-secret", defaultUserId: "user@example.com", defaultProviderId: "microsoft" },
      {
        tools: { execute: vi.fn() },
        auth: { start, status: vi.fn() },
      },
    )

    await runtime.startAuthorization({ scopes: ["Sites.Read.All"] })

    expect(start).toHaveBeenCalledWith("user@example.com", "microsoft", { scopes: ["Sites.Read.All"] })
  })
})

describe("Arcade auth/status normalization", () => {
  it("maps connected, needs-auth, and pending Arcade authorization states", () => {
    expect(normalizeArcadeAuthState({ status: "completed" })).toEqual({ status: "connected" })
    expect(normalizeArcadeAuthState({ status: "not_started", url: "https://arcade.dev/authorize" })).toEqual({
      status: "needs_auth",
      authorizationUrl: "https://arcade.dev/authorize",
    })
    expect(normalizeArcadeAuthState({ status: "pending", url: "https://arcade.dev/authorize" })).toEqual({
      status: "pending_auth",
      authorizationUrl: "https://arcade.dev/authorize",
    })
  })

  it("maps admin-consent and failed Arcade authorization states", () => {
    expect(normalizeArcadeAuthState({ status: "failed", message: "tenant admin consent required" })).toEqual({
      status: "admin_consent_required",
      message: "tenant admin consent required",
    })
    expect(normalizeArcadeAuthState({ status: "failed", error: { message: "provider unavailable" } })).toEqual({
      status: "failed",
      code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: "provider unavailable",
    })
  })

  it("normalizes authorization nested in tool execution responses", () => {
    expect(
      normalizeArcadeToolAuthState({ output: { authorization: { status: "not_started", url: "https://arcade.dev/auth" } } }),
    ).toEqual({ status: "needs_auth", authorizationUrl: "https://arcade.dev/auth" })
    expect(normalizeArcadeToolAuthState({ success: true, output: { value: { ok: true } } })).toEqual({ status: "connected" })
    expect(normalizeArcadeToolAuthState({ success: false, output: { error: { message: "tool failed" } } })).toEqual({
      status: "failed",
      code: SHAREPOINT_ERROR_CODES.PROVIDER_TOOL_FAILED,
      message: "tool failed",
    })
  })
})

describe("Arcade runtime config and redaction", () => {
  it("loads placeholder env/config names without logging secrets", () => {
    const config = loadArcadeSharePointRuntimeConfig({
      [ARCADE_ENV_KEYS.apiKey]: "sk-test-secret",
      [ARCADE_ENV_KEYS.defaultUserId]: "user@example.com",
      [ARCADE_ENV_KEYS.defaultProviderId]: "microsoft",
      [ARCADE_ENV_KEYS.baseUrl]: "https://api.arcade.dev",
    })

    expect(config).toEqual({
      apiKey: "sk-test-secret",
      defaultUserId: "user@example.com",
      defaultProviderId: "microsoft",
      baseUrl: "https://api.arcade.dev",
    })
    expect(requireArcadeSharePointRuntimeConfig(config)).toEqual(config)
    expect(redactArcadeSecret(config.apiKey)).toBe("sk-t…cret")
  })

  it("redacts API keys, bearer tokens, and token query strings recursively", () => {
    expect(
      redactArcadeConfigForLog({
        apiKey: "sk-test-secret",
        nested: {
          authorization: "Bearer abc.def.ghi",
          url: "https://example.test/callback?access_token=secret-token",
          safe: "microsoft",
        },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        url: "[REDACTED]",
        safe: "microsoft",
      },
    })
  })

  it("fails fast when the Arcade API key placeholder is missing", () => {
    expect(() => requireArcadeSharePointRuntimeConfig({ defaultProviderId: "microsoft" })).toThrow(
      `${ARCADE_ENV_KEYS.apiKey} is required`,
    )
  })
})
