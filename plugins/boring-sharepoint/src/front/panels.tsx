import type { BoringFrontAppLeftOverlayProps, PaneProps } from "@hachej/boring-workspace/plugin"
import type { OfficeDocumentSubtype } from "../shared"

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
  return (
    <section className="flex h-full min-h-0 flex-col bg-background p-4 text-sm text-foreground" data-boring-sharepoint-panel="settings">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Integration status</p>
      <h2 className="mt-1 text-lg font-semibold">SharePoint / Microsoft 365</h2>
      <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-4 text-muted-foreground">
        Connection status, authorization, and Arcade-backed provider checks will appear here in a later PR.
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

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}
