import { useEffect, useState } from "react"
import type { BoringFrontAppLeftOverlayProps, PaneProps } from "@hachej/boring-workspace/plugin"
import type { IntegrationAuthState, OfficeDocumentSubtype } from "../shared"

export interface OfficePreviewPanelParams {
  path: string
  officeKind: OfficeDocumentSubtype
  displayName: string
  webUrl?: string
}

export function OfficePreviewPanel({ params }: PaneProps<OfficePreviewPanelParams>) {
  const webUrl = safeHttpsUrl(params?.webUrl)
  const displayName = params?.displayName ?? "Office document"
  const officeKind = params?.officeKind === "powerpoint" ? "PowerPoint" : "Excel"

  return (
    <section className="flex h-full min-h-0 flex-col bg-background p-4 text-sm text-foreground" data-boring-sharepoint-panel="office-preview">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SharePoint / Microsoft 365</p>
          <h2 className="truncate text-lg font-semibold">{displayName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{officeKind} cloud reference</p>
        </div>
        {webUrl ? (
          <a
            className="inline-flex shrink-0 items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            href={webUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in SharePoint
          </a>
        ) : (
          <button
            type="button"
            className="inline-flex shrink-0 cursor-not-allowed items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-70"
            disabled
          >
            Open in SharePoint
          </button>
        )}
      </div>
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-muted-foreground">
        Office preview is not wired yet. A later SharePoint plugin PR will request a transient Microsoft preview URL on demand and render it here.
      </div>
    </section>
  )
}

export function SharePointSettingsPanel() {
  const status = useSharePointStatus()

  return (
    <section className="flex h-full min-h-0 flex-col bg-background p-4 text-sm text-foreground" data-boring-sharepoint-panel="settings">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Integration status</p>
      <h2 className="mt-1 text-lg font-semibold">SharePoint / Microsoft 365</h2>
      <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
        <p className="font-medium text-foreground">{status.label}</p>
        <p className="mt-1 text-muted-foreground">{status.detail}</p>
      </div>
      <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-4 text-muted-foreground">
        Read-only status and document discovery are wired through <code>/api/sharepoint/status</code> and <code>/api/sharepoint/resolve</code>. Preview, Office edits, and import are not enabled yet.
      </div>
    </section>
  )
}

export function SharePointSettingsOverlay({ onClose }: BoringFrontAppLeftOverlayProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-boring-sharepoint-overlay="settings">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">SharePoint / Microsoft 365</h2>
          <p className="truncate text-xs text-muted-foreground">Connection status and setup</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close SharePoint settings"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </header>
      <SharePointSettingsPanel />
    </div>
  )
}

interface SharePointStatusViewModel {
  label: string
  detail: string
}

function useSharePointStatus(): SharePointStatusViewModel {
  const [status, setStatus] = useState<SharePointStatusViewModel>({
    label: "Checking status…",
    detail: "Contacting the SharePoint plugin route.",
  })

  useEffect(() => {
    let cancelled = false
    fetch("/api/sharepoint/status")
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined)
        if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "SharePoint status request failed")
        return payload?.status as IntegrationAuthState | undefined
      })
      .then((state) => {
        if (!cancelled) setStatus(formatStatus(state))
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({
            label: "Status unavailable",
            detail: error instanceof Error ? error.message : "SharePoint status request failed",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}

function formatStatus(state: IntegrationAuthState | undefined): SharePointStatusViewModel {
  switch (state?.status) {
    case "connected":
      return { label: "Connected", detail: "Read-only SharePoint discovery is available." }
    case "needs_auth":
      return { label: "Authorization required", detail: "Connect SharePoint / Microsoft 365 to enable discovery." }
    case "pending_auth":
      return { label: "Authorization pending", detail: "Finish the Microsoft 365 authorization flow." }
    case "admin_consent_required":
      return { label: "Admin consent required", detail: state.message }
    case "failed":
      return { label: "Status unavailable", detail: state.message }
    default:
      return { label: "Status unavailable", detail: "The SharePoint status route returned an unexpected response." }
  }
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}
