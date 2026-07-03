import { SHAREPOINT_ERROR_CODES, type IntegrationAuthState } from "../shared"

type ArcadeAuthStatus = "not_started" | "pending" | "completed" | "failed"

interface ArcadeAuthorizationLike {
  status?: ArcadeAuthStatus | string
  url?: string
  error?: { message?: string; name?: string }
  message?: string
}

interface ArcadeExecuteResponseLike {
  success?: boolean
  output?: {
    authorization?: ArcadeAuthorizationLike
    error?: { message?: string; kind?: string }
  }
}

export function normalizeArcadeAuthState(response: unknown): IntegrationAuthState {
  if (!isObject(response)) {
    return failedState("Arcade authorization response was not an object")
  }

  const auth = response as ArcadeAuthorizationLike
  switch (auth.status) {
    case "completed":
      return { status: "connected" }
    case "not_started":
      if (isNonEmptyString(auth.url)) return { status: "needs_auth", authorizationUrl: auth.url }
      return { status: "failed", code: SHAREPOINT_ERROR_CODES.AUTH_REQUIRED, message: "SharePoint authorization has not started" }
    case "pending":
      return isNonEmptyString(auth.url)
        ? { status: "pending_auth", authorizationUrl: auth.url }
        : { status: "pending_auth" }
    case "failed": {
      const message = extractAuthMessage(auth) ?? "SharePoint authorization failed"
      if (looksLikeAdminConsentRequired(message)) {
        return { status: "admin_consent_required", message }
      }
      return { status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message }
    }
    default:
      return failedState(`Unsupported Arcade authorization status: ${String(auth.status ?? "missing")}`)
  }
}

export function normalizeArcadeToolAuthState(response: unknown): IntegrationAuthState {
  if (!isObject(response)) return failedState("Arcade tool response was not an object")
  const toolResponse = response as ArcadeExecuteResponseLike
  if (toolResponse.output?.authorization) return normalizeArcadeAuthState(toolResponse.output.authorization)
  if (toolResponse.success === true) return { status: "connected" }

  const message = toolResponse.output?.error?.message ?? "Arcade tool response did not include authorization state"
  if (looksLikeAdminConsentRequired(message)) return { status: "admin_consent_required", message }
  return { status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_TOOL_FAILED, message }
}

function failedState(message: string): IntegrationAuthState {
  return { status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message }
}

function extractAuthMessage(auth: ArcadeAuthorizationLike): string | undefined {
  return auth.error?.message ?? auth.message
}

function looksLikeAdminConsentRequired(message: string): boolean {
  return /admin(?:istrator)? consent|tenant admin|consent_required|AADSTS65001|AADSTS90094/i.test(message)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}
