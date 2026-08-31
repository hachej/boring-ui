"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ErrorState, IconButton, Spinner } from "@hachej/boring-ui-kit"
import { ExternalLink, RefreshCcw } from "lucide-react"
import { cn } from "../lib/utils"
import { useOptionalWorkspacePluginClient } from "../plugin/useWorkspacePluginClient"
import {
  RUNTIME_WEB_VIEW_PREVIEW_PATH,
  resolveRuntimeWebViewProjection,
  runtimeWebViewRefreshDelay,
  type RuntimeWebViewTarget,
} from "../../shared/runtimeWebView"
import { resolveUrlPaneTarget, type UrlPanePolicy } from "../../shared/urlPane"

export type RuntimeWebViewSource =
  | { readonly kind: "url"; readonly url?: string }
  | ({ readonly kind: "runtime" } & RuntimeWebViewTarget)

export interface RuntimeWebViewProps {
  source: RuntimeWebViewSource
  title?: string
  className?: string
  /** Direct URLs require the URL-pane policy. This is primarily a test seam. */
  directUrlPolicyOverride?: UrlPanePolicy
  loadingLabel?: string
  unavailableTitle?: string
  reloadLabel?: string
  openExternalLabel?: string
}

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: UrlPanePolicy }
  | { status: "error"; message: string }

type ProjectionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string; expiresAt?: string }
  | { status: "error"; message: string }

const POLICY_PATH = "/api/v1/ui/url-pane/policy"
const BASE_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

function workspaceOrigin(): string | null {
  if (typeof window === "undefined") return null
  return window.location?.origin ?? null
}

/** The framed app gets same-origin semantics only when it is not the workspace itself. */
export function runtimeWebViewSandbox(targetOrigin: string, hostOrigin: string | null): string {
  if (hostOrigin && targetOrigin.toLowerCase() === hostOrigin.toLowerCase()) return BASE_SANDBOX
  return `${BASE_SANDBOX} allow-same-origin`
}

function safeFailureMessage(kind: "policy" | "projection"): string {
  return kind === "policy"
    ? "Could not read the URL allowlist."
    : "Could not create the runtime preview."
}

export function RuntimeWebView({
  source,
  title,
  className,
  directUrlPolicyOverride,
  loadingLabel = "Loading view...",
  unavailableTitle = "Web view unavailable",
  reloadLabel = "Reload view",
  openExternalLabel = "Open view in new tab",
}: RuntimeWebViewProps) {
  const client = useOptionalWorkspacePluginClient()
  const [policyState, setPolicyState] = useState<PolicyState>(
    directUrlPolicyOverride ? { status: "ready", policy: directUrlPolicyOverride } : { status: "loading" },
  )
  const [projectionState, setProjectionState] = useState<ProjectionState>({ status: "idle" })
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    if (source.kind !== "url") return
    if (directUrlPolicyOverride) {
      setPolicyState({ status: "ready", policy: directUrlPolicyOverride })
      return
    }
    if (!client) {
      setPolicyState({ status: "error", message: "The web view needs a workspace connection." })
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
      .catch(() => {
        if (!cancelled) setPolicyState({ status: "error", message: safeFailureMessage("policy") })
      })
    return () => { cancelled = true }
  }, [client, directUrlPolicyOverride, source.kind])

  useEffect(() => {
    if (source.kind !== "runtime") {
      setProjectionState({ status: "idle" })
      return
    }
    if (!client) {
      setProjectionState({ status: "error", message: "Runtime previews need a workspace connection." })
      return
    }
    let cancelled = false
    setProjectionState({ status: "loading" })
    client
      .postJson<{ url?: unknown; expiresAt?: unknown }>(RUNTIME_WEB_VIEW_PREVIEW_PATH, {
        port: source.port,
        ...(source.path === undefined ? {} : { path: source.path }),
      })
      .then((body) => {
        if (cancelled) return
        if (typeof body?.url !== "string") throw new Error("invalid projection response")
        setProjectionState({
          status: "ready",
          url: body.url,
          ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}),
        })
      })
      .catch(() => {
        if (!cancelled) setProjectionState({ status: "error", message: safeFailureMessage("projection") })
      })
    return () => { cancelled = true }
  }, [client, reloadToken, source.kind, source.kind === "runtime" ? source.path : undefined, source.kind === "runtime" ? source.port : undefined])

  useEffect(() => {
    if (projectionState.status !== "ready") return
    const delay = runtimeWebViewRefreshDelay(projectionState.expiresAt)
    if (delay === null) return
    const timer = window.setTimeout(reload, delay)
    return () => window.clearTimeout(timer)
  }, [projectionState, reload])

  const resolution = useMemo(() => {
    if (source.kind === "runtime") {
      return projectionState.status === "ready"
        ? resolveRuntimeWebViewProjection(projectionState.url)
        : null
    }
    return policyState.status === "ready" ? resolveUrlPaneTarget(source.url, policyState.policy) : null
  }, [policyState, projectionState, source])

  const loading = source.kind === "runtime"
    ? projectionState.status === "idle" || projectionState.status === "loading"
    : policyState.status === "loading"
  const failure = source.kind === "runtime"
    ? projectionState.status === "error" ? projectionState.message : null
    : policyState.status === "error" ? policyState.message : null
  const sandbox = resolution?.ok
    ? runtimeWebViewSandbox(resolution.origin, workspaceOrigin())
    : BASE_SANDBOX
  const displayTarget = source.kind === "runtime" ? `runtime port ${source.port}` : source.url ?? "no URL"

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs font-medium text-foreground">{title ?? "Live demo"}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={displayTarget}>
          {displayTarget}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={reload}
            disabled={loading}
            aria-label={reloadLabel}
            title={reloadLabel}
          >
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconButton>
          {resolution?.ok ? (
            <IconButton asChild variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={openExternalLabel} title={openExternalLabel}>
              <a href={resolution.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>{loadingLabel}</span>
          </div>
        ) : failure ? (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState title={unavailableTitle} description={failure} />
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
              description={source.kind === "runtime"
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
