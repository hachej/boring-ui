import { MCP_ERROR_CODES, McpError, containsMcpSecret, type McpErrorCode } from "../shared"

export type ManagedConnectorSecretStorage = "server-env" | "server-vault"
export type ManagedConnectorRiskStatus = "approved" | "owner-accepted-gap"

export interface ManagedConnectorAcceptedGap {
  id: string
  owner: string
  followUp: string
  reason: string
}

export interface ManagedConnectorVendorRiskEvidence {
  dpaStatus: ManagedConnectorRiskStatus
  subprocessorStatus: ManagedConnectorRiskStatus
  dataResidencyStatus: ManagedConnectorRiskStatus
  incidentHistoryStatus: ManagedConnectorRiskStatus
  acceptedGaps?: readonly ManagedConnectorAcceptedGap[]
}

export interface ManagedConnectorPreflightEvidence {
  connectorName: string
  isolatedTestProject: boolean
  apiKeyStorage: ManagedConnectorSecretStorage
  browserDtoSamples: readonly unknown[]
  redactedLogSamples: readonly unknown[]
  redactedProviderResultSamples: readonly unknown[]
  redactionCanaries: readonly string[]
  revokeDisconnectVerified: boolean
  connectedAccountStatusVerified: boolean
  vendorRisk: ManagedConnectorVendorRiskEvidence
}

export interface ManagedConnectorPreflightCheck {
  id: string
  ok: boolean
  code?: McpErrorCode
  message: string
}

export interface ManagedConnectorPreflightResult {
  ok: boolean
  connectorName: string
  checks: ManagedConnectorPreflightCheck[]
}

const VENDOR_RISK_FIELDS = [
  "dpaStatus",
  "subprocessorStatus",
  "dataResidencyStatus",
  "incidentHistoryStatus",
] as const

function check(id: string, ok: boolean, message: string, code: McpErrorCode = MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID): ManagedConnectorPreflightCheck {
  return ok ? { id, ok, message } : { id, ok, code, message }
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function hasAcceptedGap(evidence: ManagedConnectorVendorRiskEvidence, field: (typeof VENDOR_RISK_FIELDS)[number]): boolean {
  return evidence[field] === "approved" || Boolean(evidence.acceptedGaps?.some((gap) => gap.id === field && hasText(gap.owner) && hasText(gap.followUp) && hasText(gap.reason)))
}

function stringContainsCanary(value: string, canaries: readonly string[]): boolean {
  return canaries.some((canary) => hasText(canary) && value.includes(canary))
}

function containsCanary(value: unknown, canaries: readonly string[]): boolean {
  if (typeof value === "string") return stringContainsCanary(value, canaries)
  if (Array.isArray(value)) return value.some((item) => containsCanary(item, canaries))
  if (!value || typeof value !== "object") return false
  return Object.entries(value).some(([key, nested]) => stringContainsCanary(key, canaries) || containsCanary(nested, canaries))
}

export function validateManagedConnectorPreflight(evidence: ManagedConnectorPreflightEvidence): ManagedConnectorPreflightResult {
  const hasBrowserSamples = evidence.browserDtoSamples.length > 0
  const hasLogSamples = evidence.redactedLogSamples.length > 0
  const hasProviderResultSamples = evidence.redactedProviderResultSamples.length > 0
  const hasCanaries = evidence.redactionCanaries.some(hasText)
  const browserHasSecret = evidence.browserDtoSamples.some(containsMcpSecret) || containsCanary(evidence.browserDtoSamples, evidence.redactionCanaries)
  const logsHaveSecret = evidence.redactedLogSamples.some(containsMcpSecret) || containsCanary(evidence.redactedLogSamples, evidence.redactionCanaries)
  const providerResultsHaveSecret = evidence.redactedProviderResultSamples.some(containsMcpSecret) || containsCanary(evidence.redactedProviderResultSamples, evidence.redactionCanaries)
  const vendorRiskOk = VENDOR_RISK_FIELDS.every((field) => hasAcceptedGap(evidence.vendorRisk, field))

  const checks: ManagedConnectorPreflightCheck[] = [
    check("isolated-test-project", evidence.isolatedTestProject, "Connector test project is isolated from production data"),
    check("server-only-api-key", evidence.apiKeyStorage === "server-env" || evidence.apiKeyStorage === "server-vault", "Connector API key resolves only from server env/Vault"),
    check("redaction-canaries-present", hasCanaries, "Explicit redaction canaries are provided for browser/log/provider-result evidence"),
    check("browser-dto-secret-free", hasBrowserSamples && !browserHasSecret, "Browser DTO samples contain no API keys, OAuth tokens, cookies, MCP session headers, or seeded canaries", MCP_ERROR_CODES.SECRET_LEAK_GUARD),
    check("log-redaction-canary", hasLogSamples && !logsHaveSecret, "Redacted log samples contain no connector/API/session/OAuth canaries", MCP_ERROR_CODES.SECRET_LEAK_GUARD),
    check("provider-result-redaction-canary", hasProviderResultSamples && !providerResultsHaveSecret, "Redacted provider result samples contain no connector/API/session/OAuth canaries", MCP_ERROR_CODES.SECRET_LEAK_GUARD),
    check("revoke-disconnect", evidence.revokeDisconnectVerified, "Revoke/disconnect behavior has been verified for the connector"),
    check("connected-account-status", evidence.connectedAccountStatusVerified, "Connected-account status refresh behavior has been verified"),
    check("vendor-risk", vendorRiskOk, "DPA, subprocessors, data residency, and incident-history risk are approved or owner-accepted"),
  ]

  return { ok: checks.every((item) => item.ok), connectorName: evidence.connectorName, checks }
}

export function assertManagedConnectorPreflight(evidence: ManagedConnectorPreflightEvidence): void {
  const result = validateManagedConnectorPreflight(evidence)
  if (!result.ok) {
    const failed = result.checks.filter((item) => !item.ok).map((item) => item.id).join(", ")
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, `Managed connector preflight failed for ${result.connectorName}: ${failed}`, result)
  }
}
