"use client"

import { useEffect, useMemo, useState } from "react"
import { ErrorState, IconButton, Spinner } from "@hachej/boring-ui-kit"
import { ExternalLink, RefreshCcw } from "lucide-react"
import { cn } from "../../../front/lib/utils"
import { useOptionalWorkspacePluginClient } from "../../../front/plugin/useWorkspacePluginClient"
import { resolveUrlPaneTarget, type UrlPanePolicy } from "../../../shared/urlPane"

export interface UrlPaneProps {
  url?: string
  title?: string
  className?: string
  /** Test seam: skip the policy fetch and decide against this policy directly. */
  policyOverride?: UrlPanePolicy
}

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: UrlPanePolicy }
  | { status: "error"; message: string }

const POLICY_PATH = "/api/v1/ui/url-pane/policy"

export function UrlPane({ url, title, className, policyOverride }: UrlPaneProps) {
  const client = useOptionalWorkspacePluginClient()
  const [policyState, setPolicyState] = useState<PolicyState>(
    policyOverride ? { status: "ready", policy: policyOverride } : { status: "loading" },
  )
  // Bumping this remounts the iframe, which is the only reliable cross-origin
  // reload — we cannot touch contentWindow.location on a sandboxed frame.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
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
  }, [client, policyOverride])

  const resolution = useMemo(
    () => (policyState.status === "ready" ? resolveUrlPaneTarget(url, policyState.policy) : null),
    [policyState, url],
  )

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs font-medium text-foreground">{title ?? "Live demo"}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={url}>
          {url ?? "no URL"}
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
        {policyState.status === "loading" ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>Loading demo...</span>
          </div>
        ) : policyState.status === "error" ? (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState title="URL pane unavailable" description={policyState.message} />
          </div>
        ) : resolution?.ok ? (
          <iframe
            key={`${resolution.url}#${reloadToken}`}
            src={resolution.url}
            title={title ?? resolution.url}
            className="h-full w-full border-0 bg-white"
            // No allow-same-origin: the framed demo must never reach the
            // workspace origin's storage or DOM.
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState
              title="URL blocked"
              description={`${resolution?.message ?? "This URL cannot be embedded."} Allowed origins: ${
                policyState.policy.origins.join(", ") || "(none configured)"
              }`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
