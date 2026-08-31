import { z } from "zod"

/** Canonical route for projecting a selected runtime port into the workspace UI. */
export const RUNTIME_WEB_VIEW_PREVIEW_PATH = "/api/v1/ui/runtime-web-view/preview"
/** Compatibility route introduced by #1493. New callers use the canonical route above. */
export const LEGACY_URL_PANE_RUNTIME_PREVIEW_PATH = "/api/v1/ui/url-pane/runtime-preview"

export const runtimeWebViewTargetSchema = z.object({
  port: z.number().int().min(1024).max(65_535),
  path: z.string().startsWith("/").max(2_048).refine((path) => !path.includes("\\"), {
    message: "Path may not contain backslashes.",
  }).optional(),
}).strict()

export type RuntimeWebViewTarget = z.infer<typeof runtimeWebViewTargetSchema>

export type RuntimeWebViewProjectionRejectionReason =
  | "empty"
  | "unparseable"
  | "protocol-not-allowed"
  | "credentials-not-allowed"
  | "local-target-not-allowed"

export type RuntimeWebViewProjectionResolution =
  | { ok: true; url: string; origin: string }
  | { ok: false; reason: RuntimeWebViewProjectionRejectionReason; message: string }

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]"
}

function hasCanonicalLoopbackAuthority(input: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:[/?#]|$)/i.test(input)
}

/**
 * Revalidates a Host-created projection before it reaches an iframe.
 * Hosted projections are credential-free HTTPS. Local projections are HTTP(S)
 * loopback with an explicit, bounded port. No provider/runtime identity is
 * accepted from the caller.
 */
export function resolveRuntimeWebViewProjection(
  input: string | undefined | null,
): RuntimeWebViewProjectionResolution {
  const trimmed = (input ?? "").trim()
  if (!trimmed) {
    return { ok: false, reason: "empty", message: "The runtime preview did not return a URL." }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: "unparseable", message: "The runtime preview returned an invalid URL." }
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: "credentials-not-allowed",
      message: "Runtime preview URLs may not carry URL credentials.",
    }
  }

  const loopback = isLoopbackHostname(parsed.hostname)
  if (!loopback && parsed.protocol === "https:") {
    return { ok: true, url: parsed.toString(), origin: parsed.origin }
  }

  if (!loopback && parsed.protocol !== "https:") {
    return { ok: false, reason: "protocol-not-allowed", message: "Hosted runtime previews must use HTTPS." }
  }

  if (!hasCanonicalLoopbackAuthority(trimmed) || !parsed.port) {
    return {
      ok: false,
      reason: "local-target-not-allowed",
      message: "HTTP runtime previews must use loopback with an explicit port.",
    }
  }
  const port = Number(parsed.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    return {
      ok: false,
      reason: "local-target-not-allowed",
      message: "HTTP runtime previews must use a bounded loopback port.",
    }
  }

  return { ok: true, url: parsed.toString(), origin: parsed.origin }
}

/** Refresh shortly before expiration, while avoiding tight timer loops. */
export function runtimeWebViewRefreshDelay(expiresAt: string | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(expiry)) return null
  return Math.max(1_000, expiry - now - 30_000)
}
