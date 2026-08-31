"use client"

import { useEffect, useMemo, useState } from "react"
import { ErrorState, IconButton, Spinner } from "@hachej/boring-ui-kit"
import { ExternalLink, RefreshCcw } from "lucide-react"
import { cn } from "../../../front/lib/utils"
import { useOptionalWorkspacePluginClient } from "../../../front/plugin/useWorkspacePluginClient"
import {
  resolveRuntimePreviewUrl,
  resolveUrlPaneTarget,
  type RuntimePreviewTarget,
  type UrlPanePolicy,
} from "../../../shared/urlPane"

export interface UrlPaneProps {
  url?: string
  runtimePreview?: RuntimePreviewTarget
  title?: string
  className?: string
  /** Test seam: skip the policy fetch and decide against this policy directly. */
  policyOverride?: UrlPanePolicy
}

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: UrlPanePolicy }
  | { status: "error"; message: string }

type RuntimePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string }

const POLICY_PATH = "/api/v1/ui/url-pane/policy"

const BASE_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

function workspaceOrigin(): string | null {
  if (typeof window === "undefined") return null
  return window.location?.origin ?? null
}

/**
 * `allow-same-origin` is what makes a real app work in here: without it the
 * frame runs on an opaque origin, and every module script the demo loads is
 * fetched in CORS mode from `origin: null` — a plain Vite dev server then
 * renders blank. It is only dangerous when the framed document is same-origin
 * with the *workspace*, because then `allow-scripts allow-same-origin` lets the
 * frame reach into the parent's origin and remove its own sandbox. Different
 * port means different origin, which covers every real worker demo; a workspace
 * embedding itself keeps the strict sandbox.
 */
export function urlPaneSandbox(targetOrigin: string, hostOrigin: string | null): string {
  if (hostOrigin && targetOrigin.toLowerCase() === hostOrigin.toLowerCase()) return BASE_SANDBOX
  return `${BASE_SANDBOX} allow-same-origin`
}

export function UrlPane({ url, runtimePreview, title, className, policyOverride }: UrlPaneProps) {
  const client = useOptionalWorkspacePluginClient()
  const [policyState, setPolicyState] = useState<PolicyState>(
    policyOverride ? { status: "ready", policy: policyOverride } : { status: "loading" },
  )
  const [runtimePreviewState, setRuntimePreviewState] = useState<RuntimePreviewState>({ status: "idle" })
  // Bumping this remounts the iframe, which is the only reliable cross-origin
  // reload — we cannot touch contentWindow.location on a sandboxed frame.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (runtimePreview) return
    if (policyOverride) {
      setPolicyState({ status: "ready", policy: policyOverride })
      return
    }
    if (!client) {
      setPolicyState({
        status: "error",
        message: "The URL pane needs a workspace connection to read its origin allowlist.",
      })
      return
    }
    let cancelled = false
    setPolicyState({ status: "loading" })
    client
      .getJson<{ origins?: unknown }>(POLICY_PATH)
      .then((body) => {
        if (cancelled) return
        const origins = Array.isArray(body?.origins)
          ? body.origins.filter((entry): entry is string => typeof entry === "string")
          : []
        setPolicyState({ status: "ready", policy: { origins } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Fail closed: an unreachable policy endpoint must never widen the
        // allowlist to "anything".
        setPolicyState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not read the URL pane allowlist.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [client, policyOverride, runtimePreview])

  useEffect(() => {
    if (!runtimePreview) {
      setRuntimePreviewState({ status: "idle" })
      return
    }
    if (!client) {
      setRuntimePreviewState({ status: "error", message: "Runtime previews need a workspace connection." })
      return
    }
    let cancelled = false
    setRuntimePreviewState({ status: "loading" })
    client
      .postJson<{ url?: unknown }>("/api/v1/ui/url-pane/runtime-preview", runtimePreview)
      .then((body) => {
        if (cancelled) return
        if (typeof body?.url !== "string") throw new Error("The runtime preview did not return a URL.")
        setRuntimePreviewState({ status: "ready", url: body.url })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setRuntimePreviewState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not create the runtime preview.",
        })
      })
    return () => { cancelled = true }
  }, [client, runtimePreview?.path, runtimePreview?.port])

  const resolution = useMemo(() => {
    if (runtimePreview) {
      return runtimePreviewState.status === "ready"
        ? resolveRuntimePreviewUrl(runtimePreviewState.url)
        : null
    }
    return policyState.status === "ready" ? resolveUrlPaneTarget(url, policyState.policy) : null
  }, [policyState, runtimePreview, runtimePreviewState, url])

  const sandbox = useMemo(
    () => (resolution?.ok ? urlPaneSandbox(resolution.origin, workspaceOrigin()) : BASE_SANDBOX),
    [resolution],
  )

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs font-medium text-foreground">{title ?? "Live demo"}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={resolution?.ok ? resolution.url : url}>
          {runtimePreview ? `sandbox port ${runtimePreview.port}` : url ?? "no URL"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setReloadToken((token) => token + 1)}
            disabled={!resolution?.ok}
            aria-label="Reload demo"
            title="Reload demo"
          >
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconButton>
          {resolution?.ok ? (
            <IconButton
              asChild
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open demo in new tab"
              title="Open demo in new tab"
            >
              <a href={resolution.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {(runtimePreview
          ? runtimePreviewState.status === "idle" || runtimePreviewState.status === "loading"
          : policyState.status === "loading") ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>Loading demo...</span>
          </div>
        ) : (runtimePreview ? runtimePreviewState.status === "error" : policyState.status === "error") ? (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState
              title="URL pane unavailable"
              description={runtimePreviewState.status === "error"
                ? runtimePreviewState.message
                : policyState.status === "error" ? policyState.message : "URL pane unavailable"}
            />
          </div>
        ) : resolution?.ok ? (
          <iframe
            key={`${resolution.url}#${reloadToken}`}
            src={resolution.url}
            title={title ?? resolution.url}
            className="h-full w-full border-0 bg-white"
            sandbox={sandbox}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState
              title="URL blocked"
              description={runtimePreview
                ? resolution?.message ?? "This runtime preview cannot be embedded."
                : `${resolution?.message ?? "This URL cannot be embedded."} Allowed origins: ${
                    policyState.status === "ready" ? policyState.policy.origins.join(", ") || "(none configured)" : "(unavailable)"
                  }`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
