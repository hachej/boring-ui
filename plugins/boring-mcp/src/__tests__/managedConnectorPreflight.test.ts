import { describe, expect, it } from "vitest"
import { MCP_ERROR_CODES, McpError } from "../shared"
import { assertManagedConnectorPreflight, validateManagedConnectorPreflight, type ManagedConnectorPreflightEvidence } from "../server/managedConnectorPreflight"

const cleanEvidence: ManagedConnectorPreflightEvidence = {
  connectorName: "composio-test",
  isolatedTestProject: true,
  apiKeyStorage: "server-vault",
  browserDtoSamples: [{ sourceId: "source-1", status: "connected", providerAccountLabel: "demo@example.com" }],
  redactedLogSamples: [{ message: "connected", authorization: "[REDACTED_MCP_SECRET]" }],
  redactedProviderResultSamples: [{ content: "ok", session_headers: "[REDACTED_MCP_SECRET]" }],
  redactionCanaries: ["COMPOSIO_CANARY_DO_NOT_LEAK_123"],
  revokeDisconnectVerified: true,
  connectedAccountStatusVerified: true,
  vendorRisk: {
    dpaStatus: "approved",
    subprocessorStatus: "approved",
    dataResidencyStatus: "approved",
    incidentHistoryStatus: "approved",
  },
}

describe("managed connector preflight", () => {
  it("passes only when every connector security gate has evidence", () => {
    const result = validateManagedConnectorPreflight(cleanEvidence)

    expect(result.ok).toBe(true)
    expect(result.checks.every((item) => item.ok)).toBe(true)
    expect(() => assertManagedConnectorPreflight(cleanEvidence)).not.toThrow()
  })

  it("fails closed when browser DTOs or redaction canaries contain secrets", () => {
    const result = validateManagedConnectorPreflight({
      ...cleanEvidence,
      browserDtoSamples: [{ sourceId: "source-1", mcp: { headers: { authorization: "Bearer abcdefghijklmnop" } } }],
      redactedLogSamples: ["x-api-key: abcdefghijklmnop"],
      redactedProviderResultSamples: [{ access_token: "provider-token" }],
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "browser-dto-secret-free", ok: false, code: MCP_ERROR_CODES.SECRET_LEAK_GUARD }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "log-redaction-canary", ok: false, code: MCP_ERROR_CODES.SECRET_LEAK_GUARD }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "provider-result-redaction-canary", ok: false, code: MCP_ERROR_CODES.SECRET_LEAK_GUARD }))
  })

  it("requires non-empty evidence samples and explicit arbitrary canaries", () => {
    const emptyEvidence = validateManagedConnectorPreflight({
      ...cleanEvidence,
      browserDtoSamples: [],
      redactedLogSamples: [],
      redactedProviderResultSamples: [],
      redactionCanaries: [],
    })
    expect(emptyEvidence.ok).toBe(false)
    expect(emptyEvidence.checks).toContainEqual(expect.objectContaining({ id: "redaction-canaries-present", ok: false }))
    expect(emptyEvidence.checks).toContainEqual(expect.objectContaining({ id: "browser-dto-secret-free", ok: false }))
    expect(emptyEvidence.checks).toContainEqual(expect.objectContaining({ id: "log-redaction-canary", ok: false }))
    expect(emptyEvidence.checks).toContainEqual(expect.objectContaining({ id: "provider-result-redaction-canary", ok: false }))

    const leakedCanary = validateManagedConnectorPreflight({
      ...cleanEvidence,
      redactedLogSamples: ["COMPOSIO_CANARY_DO_NOT_LEAK_123"],
    })
    expect(leakedCanary.ok).toBe(false)
    expect(leakedCanary.checks).toContainEqual(expect.objectContaining({ id: "log-redaction-canary", ok: false }))

    const escapedCanary = 'COMPOSIO_CANARY_"quoted"\\line\nnext'
    const escapedLeak = validateManagedConnectorPreflight({
      ...cleanEvidence,
      redactionCanaries: [escapedCanary],
      redactedProviderResultSamples: [{ nested: [escapedCanary] }],
    })
    expect(escapedLeak.ok).toBe(false)
    expect(escapedLeak.checks).toContainEqual(expect.objectContaining({ id: "provider-result-redaction-canary", ok: false }))
  })

  it("requires owner-tracked accepted gaps for unresolved vendor-risk gates", () => {
    const missingGap = validateManagedConnectorPreflight({
      ...cleanEvidence,
      vendorRisk: { ...cleanEvidence.vendorRisk, dpaStatus: "owner-accepted-gap" },
    })
    expect(missingGap.ok).toBe(false)
    expect(missingGap.checks).toContainEqual(expect.objectContaining({ id: "vendor-risk", ok: false }))

    const whitespaceGap = validateManagedConnectorPreflight({
      ...cleanEvidence,
      vendorRisk: {
        ...cleanEvidence.vendorRisk,
        dpaStatus: "owner-accepted-gap",
        acceptedGaps: [{ id: "dpaStatus", owner: " ", followUp: " ", reason: " " }],
      },
    })
    expect(whitespaceGap.ok).toBe(false)

    const acceptedGap = validateManagedConnectorPreflight({
      ...cleanEvidence,
      vendorRisk: {
        ...cleanEvidence.vendorRisk,
        dpaStatus: "owner-accepted-gap",
        acceptedGaps: [{ id: "dpaStatus", owner: "julien", followUp: "PR 3 launch gate", reason: "non-production connector spike only" }],
      },
    })
    expect(acceptedGap.ok).toBe(true)
  })

  it("reports missing revoke and status verification before real connector use", () => {
    const result = validateManagedConnectorPreflight({
      ...cleanEvidence,
      revokeDisconnectVerified: false,
      connectedAccountStatusVerified: false,
    })

    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "revoke-disconnect", ok: false }))
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "connected-account-status", ok: false }))
  })

  it("requires stable coded assertion failures", () => {
    expect(() => assertManagedConnectorPreflight({ ...cleanEvidence, isolatedTestProject: false })).toThrow(McpError)
    expect(() => assertManagedConnectorPreflight({ ...cleanEvidence, isolatedTestProject: false })).toThrow(/isolated-test-project/)
  })
})
