"use client"

import { RuntimeWebView, runtimeWebViewSandbox } from "../../../front/components/RuntimeWebView"
import type { RuntimeWebViewTarget } from "../../../shared/runtimeWebView"
import type { UrlPanePolicy } from "../../../shared/urlPane"

export interface UrlPaneProps {
  url?: string
  runtimePreview?: RuntimeWebViewTarget
  title?: string
  className?: string
  /** Test seam: skip the policy fetch and decide against this policy directly. */
  policyOverride?: UrlPanePolicy
}

/** Compatibility export for callers/tests of the original URL-pane component. */
export const urlPaneSandbox = runtimeWebViewSandbox

/** URL pane is now a thin adapter over the central runtime-neutral web view. */
export function UrlPane({ url, runtimePreview, title, className, policyOverride }: UrlPaneProps) {
  return (
    <RuntimeWebView
      source={runtimePreview
        ? { kind: "runtime", port: runtimePreview.port, ...(runtimePreview.path === undefined ? {} : { path: runtimePreview.path }) }
        : { kind: "url", url }}
      title={title}
      className={className}
      directUrlPolicyOverride={policyOverride}
      loadingLabel="Loading demo..."
      unavailableTitle="URL pane unavailable"
      reloadLabel="Reload demo"
      openExternalLabel="Open demo in new tab"
    />
  )
}
