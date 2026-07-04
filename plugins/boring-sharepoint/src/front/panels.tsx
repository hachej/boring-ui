import { useEffect, useMemo, useState } from "react"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import {
  SHAREPOINT_ERROR_CODES,
  SharePointRefValidationError,
  officeKindDisplayLabel,
  parseSharePointDocumentRef,
  parseSharePointDocumentRefJson,
  sharePointDriveDisplayLabel,
  sharePointSiteDisplayLabel,
  type OfficeDocumentSubtype,
  type SharePointDocumentRef,
  type SharePointErrorCode,
} from "../shared"

export interface OfficePreviewPanelParams {
  path: string
  officeKind: OfficeDocumentSubtype
  displayName: string
  sharePointRef?: SharePointDocumentRef
}

export function OfficePreviewPanel({ params }: PaneProps<OfficePreviewPanelParams>) {
  const refState = useSharePointDocumentRef(params)
  const displayName = refState.status === "ready" ? refState.ref.name : params?.displayName ?? "Office document"
  const officeKind = refState.status === "ready"
    ? officeKindDisplayLabel(refState.ref.officeKind)
    : params?.officeKind
      ? officeKindDisplayLabel(params.officeKind)
      : "Office cloud reference"

  return (
    <section className="flex h-full min-h-0 flex-col bg-background p-4 text-sm text-foreground" data-boring-sharepoint-panel="office-preview">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SharePoint / Microsoft 365</p>
          <h2 className="truncate text-lg font-semibold">{displayName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{officeKind}</p>
        </div>
        {refState.status === "ready" ? (
          <a
            className="inline-flex shrink-0 items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            href={refState.ref.webUrl}
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
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/20">
        {refState.status === "loading" ? (
          <div className="p-4 text-muted-foreground">Loading SharePoint cloud reference...</div>
        ) : refState.status === "error" ? (
          <SharePointRefErrorView code={refState.code} message={refState.message} path={params?.path} />
        ) : (
          <SharePointDocumentCard refFilePath={params.path} docRef={refState.ref} />
        )}
      </div>
    </section>
  )
}

function SharePointDocumentCard({ refFilePath, docRef }: { refFilePath: string; docRef: SharePointDocumentRef }) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
      <div className="min-w-0 rounded-md border border-border bg-background p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Document</p>
        <h3 className="mt-1 truncate text-base font-semibold">{docRef.name}</h3>
        <dl className="mt-4 grid gap-3 text-sm">
          <MetadataRow label="Cloud ref file" value={refFilePath} />
          <MetadataRow label="Type" value={officeKindDisplayLabel(docRef.officeKind)} />
          <MetadataRow label="MIME type" value={docRef.mimeType} />
          {docRef.createdFrom?.originalPath ? <MetadataRow label="Imported from" value={docRef.createdFrom.originalPath} /> : null}
        </dl>
      </div>
      <div className="min-w-0 rounded-md border border-border bg-background p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SharePoint identity</p>
        <dl className="mt-4 grid gap-3 text-sm">
          <MetadataRow label="Site" value={sharePointSiteDisplayLabel(docRef)} />
          <MetadataRow label="Drive" value={sharePointDriveDisplayLabel(docRef)} />
          <MetadataRow label="Drive item" value={docRef.driveItemId} />
        </dl>
      </div>
    </div>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-xs text-foreground">{value}</dd>
    </div>
  )
}

function SharePointRefErrorView({ code, message, path }: { code: SharePointErrorCode; message: string; path?: string }) {
  return (
    <div className="p-4 text-muted-foreground" role="alert">
      <p className="font-medium text-foreground">SharePoint cloud reference unavailable</p>
      <p className="mt-1 font-mono text-xs text-destructive">{code}</p>
      <p className="mt-2">{message}</p>
      {path ? <p className="mt-3 break-words font-mono text-xs">{path}</p> : null}
    </div>
  )
}

type SharePointDocumentRefState =
  | { status: "loading" }
  | { status: "ready"; ref: SharePointDocumentRef }
  | { status: "error"; code: SharePointErrorCode; message: string }

class SharePointRefLoadError extends Error {
  readonly code: SharePointErrorCode

  constructor(code: SharePointErrorCode, message: string) {
    super(message)
    this.name = "SharePointRefLoadError"
    this.code = code
  }
}

function useSharePointDocumentRef(params: OfficePreviewPanelParams | undefined): SharePointDocumentRefState {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const path = params?.path
  const fastPathRef = params?.sharePointRef
  const rawUrl = useMemo(() => (path ? rawSharePointRefFileUrl(apiBaseUrl, path) : null), [apiBaseUrl, path])
  const [state, setState] = useState<SharePointDocumentRefState>({ status: "loading" })

  useEffect(() => {
    if (fastPathRef) {
      try {
        setState({ status: "ready", ref: parseSharePointDocumentRef(fastPathRef) })
        return
      } catch (error) {
        if (!rawUrl) {
          setState(toSharePointRefErrorState(error))
          return
        }
      }
    }

    if (!rawUrl) {
      setState({
        status: "error",
        code: SHAREPOINT_ERROR_CODES.INVALID_REF,
        message: "Cloud reference panel requires a workspace file path.",
      })
      return
    }

    const controller = new AbortController()
    const headers: Record<string, string> = {}
    if (workspaceRequestId) headers["x-boring-workspace-id"] = workspaceRequestId

    setState({ status: "loading" })
    void fetch(rawUrl, {
      credentials: "include",
      headers,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new SharePointRefLoadError(
            SHAREPOINT_ERROR_CODES.FILE_NOT_FOUND,
            `Could not read SharePoint cloud reference file: HTTP ${response.status}`,
          )
        }
        return parseSharePointDocumentRefJson(await response.text())
      })
      .then((ref) => {
        if (!controller.signal.aborted) setState({ status: "ready", ref })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState(toSharePointRefErrorState(error))
      })
    return () => {
      controller.abort()
    }
  }, [fastPathRef, rawUrl, workspaceRequestId])

  return state
}

export function rawSharePointRefFileUrl(apiBaseUrl: string, path: string): string {
  const base = apiBaseUrl.replace(/\/$/, "")
  const query = new URLSearchParams({ path })
  return `${base}/api/v1/files/raw?${query.toString()}`
}

function toSharePointRefErrorState(error: unknown): SharePointDocumentRefState {
  if (error instanceof SharePointRefValidationError || error instanceof SharePointRefLoadError) {
    return { status: "error", code: error.code, message: error.message }
  }
  return {
    status: "error",
    code: SHAREPOINT_ERROR_CODES.FILE_NOT_FOUND,
    message: error instanceof Error ? error.message : "Could not read SharePoint cloud reference file.",
  }
}
