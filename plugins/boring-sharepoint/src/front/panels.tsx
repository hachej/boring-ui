import { useEffect, useState } from "react"
import type { BoringFrontAppLeftOverlayProps, PaneProps } from "@hachej/boring-workspace/plugin"
import type { CreateOfficePreviewUrlResult, IntegrationAuthState, OfficeDocumentSubtype, SharePointDocumentRef } from "../shared"

export interface OfficePreviewPanelParams {
  path: string
  officeKind: OfficeDocumentSubtype
  displayName: string
  webUrl?: string
  driveId?: string
  driveItemId?: string
  sharePointRef?: SharePointDocumentRef
}

export function OfficePreviewPanel({ params }: PaneProps<OfficePreviewPanelParams>) {
  const webUrl = safeHttpsUrl(params?.webUrl)
  const displayName = params?.displayName ?? "Office document"
  const officeKind = params?.officeKind === "powerpoint" ? "PowerPoint" : "Excel"
  const preview = useOfficePreview(params)

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
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/20">
        {preview.status === "loading" ? (
          <div className="p-4 text-muted-foreground">Requesting a transient Microsoft 365 preview URL…</div>
        ) : preview.status === "error" ? (
          <div className="p-4 text-muted-foreground" role="alert">
            <p className="font-medium text-foreground">Preview unavailable</p>
            <p className="mt-1">{preview.message}</p>
          </div>
        ) : preview.getUrl ? (
          <iframe
            title={`${displayName} preview`}
            src={preview.getUrl}
            className="h-full min-h-[480px] w-full border-0 bg-background"
            sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="p-4 text-muted-foreground">Preview is unavailable for this SharePoint cloud reference.</div>
        )}
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
        Read-only status and document discovery are wired through <code>/api/sharepoint/status</code> and <code>/api/sharepoint/resolve</code>. Office preview is generated on demand through <code>/api/sharepoint/preview</code>; Office edits and import are not enabled yet.
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

type OfficePreviewState =
  | { status: "loading" }
  | { status: "ready"; getUrl: string }
  | { status: "error"; message: string }

interface SharePointStatusViewModel {
  label: string
  detail: string
}

function useOfficePreview(params: OfficePreviewPanelParams | undefined): OfficePreviewState {
  const [preview, setPreview] = useState<OfficePreviewState>({ status: "loading" })

  useEffect(() => {
    const body = previewRequestBody(params)
    if (!body) {
      setPreview({ status: "error", message: "This cloud reference does not include SharePoint drive identity." })
      return
    }

    let cancelled = false
    setPreview({ status: "loading" })
    fetch("/api/sharepoint/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined)
        if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "SharePoint preview request failed")
        const getUrl = safeHttpsUrl((payload as CreateOfficePreviewUrlResult | undefined)?.getUrl)
        if (!getUrl) throw new Error("SharePoint preview response did not include a safe HTTPS URL")
        return getUrl
      })
      .then((getUrl) => {
        if (!cancelled) setPreview({ status: "ready", getUrl })
      })
      .catch((error) => {
        if (!cancelled) {
          setPreview({ status: "error", message: error instanceof Error ? error.message : "SharePoint preview request failed" })
        }
      })
    return () => {
      cancelled = true
    }
  }, [params])

  return preview
}

export function previewRequestBody(params: OfficePreviewPanelParams | undefined): { ref: SharePointDocumentRef } | { driveId: string; driveItemId: string } | null {
  if (params?.sharePointRef) return { ref: params.sharePointRef }
  if (params?.driveId && params.driveItemId) return { driveId: params.driveId, driveItemId: params.driveItemId }
  return null
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
