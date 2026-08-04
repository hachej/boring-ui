"use client"

import { lazy, Suspense } from "react"
import type { ReactNode } from "react"
import { EmptyState, ErrorState, Spinner } from "@hachej/boring-ui-kit"
import { ChevronRight } from "lucide-react"
import { ConflictBanner } from "./ConflictBanner"
import { FetchError, type FileConflictError } from "./data/fetchClient"
import { redactedFilesystemErrorMessage } from "./data/filesystemErrorRedaction"

function governedPathSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  const segments = normalized.split("/").filter((segment) => segment && segment !== "." && segment !== "..")
  // Governed workspace paths are relative. If a host accidentally supplies an
  // absolute path, disclose only the filename instead of leaking host roots.
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return segments.slice(-1)
  }
  return segments.length > 0 ? segments : [path]
}

export interface FilePaneShellProps {
  /** The file path being edited (for "no file selected" check). */
  path: string
  /** The file content (null = loading). */
  content: string | null
  /** Loading state from React Query. */
  isLoading: boolean
  /** Error from React Query. */
  error: Error | null
  /** Conflict state (if OCC check failed). */
  conflict: FileConflictError | null
  /** Readonly panes disable mutation affordances by construction. */
  readOnly?: boolean
  /** Handler for content changes. */
  onChange: (content: string) => void
  /** Handler for reload from server. */
  onReload: () => void | Promise<void>
  /** Handler for overwrite server. */
  onOverwrite: () => void | Promise<void>
  /** The actual editor component to render. */
  editorComponent: React.ComponentType<{
    content: string
    onChange: (content: string) => void
    readOnly?: boolean
    className?: string
    [key: string]: unknown
  }>
  /** Additional props to pass to the editor component. */
  editorProps?: Record<string, unknown>
  /** Custom loading fallback (optional). */
  loadingFallback?: ReactNode
  /** Custom error message (optional). */
  errorMessage?: string
  /** Filesystem identity for disclosure-safe governed filesystem error rendering. */
  filesystem?: string
  /** Wrapper className for the root element. */
  className?: string
}

/**
 * Shared shell for file-based editor panes.
 *
 * Handles:
 * - "No file selected" state
 * - Error display
 * - Loading fallback
 * - Conflict banner
 * - Suspense boundary for lazy-loaded editors
 *
 * @example
 * ```typescript
 * function CodeEditorPane({ params }) {
 *   const { content, isLoading, error, conflict, setContent, ... } = useFilePane({ path: params.path })
 *
 *   return (
 *     <FilePaneShell
 *       path={params.path}
 *       content={content}
 *       isLoading={isLoading}
 *       error={error}
 *       conflict={conflict}
 *       onChange={setContent}
 *       onReload={onReloadFromServer}
 *       onOverwrite={onOverwrite}
 *       editorComponent={CodeEditor}
 *       editorProps={{ language: "typescript", wordWrap: true }}
 *     />
 *   )
 * }
 * ```
 */
export function FilePaneShell({
  path,
  content,
  isLoading,
  error,
  conflict,
  readOnly = false,
  onChange,
  onReload,
  onOverwrite,
  editorComponent: Editor,
  editorProps = {},
  loadingFallback,
  errorMessage,
  filesystem,
  className,
}: FilePaneShellProps) {
  // No file selected
  if (!/\S/.test(path)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState className="min-h-0 border-0" title="No file selected" description="Choose a file from the file tree to open an editor." />
      </div>
    )
  }

  // Error state
  if (error) {
    const description = error instanceof FetchError
      ? redactedFilesystemErrorMessage(filesystem, error.status, error.message)
      : error.message
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState title="Failed to load file" description={errorMessage ?? description} />
      </div>
    )
  }

  const loadingSpinner = loadingFallback ?? (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      <span>Loading file...</span>
    </div>
  )

  const relativeSegments = governedPathSegments(path)
  const displayPath = relativeSegments.join("/")

  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ""}`}>
      <nav
        aria-label={`File path: ${displayPath}`}
        title={displayPath}
        data-boring-workspace-part="file-path-header"
        className="flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-border/60 bg-background px-3 text-[12px] leading-none"
      >
        <span className="shrink-0 text-muted-foreground/70">Workspace</span>
        {relativeSegments.map((segment, index) => (
          <span key={`${segment}-${index}`} className="contents">
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/45" strokeWidth={1.75} />
            <span
              className={index === relativeSegments.length - 1
                ? "min-w-0 truncate font-medium text-foreground"
                : "shrink-0 text-muted-foreground"}
            >
              {segment}
            </span>
          </span>
        ))}
      </nav>
      {readOnly && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground" role="status">
          <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-medium text-foreground">Readonly</span>
          <span>{filesystem === "company_context" ? "Company context is policy-filtered and cannot be edited here." : "This file is readonly."}</span>
        </div>
      )}
      {!readOnly && conflict && (
        <ConflictBanner
          conflict={conflict}
          onReload={onReload}
          onOverwrite={onOverwrite}
        />
      )}
      <Suspense fallback={loadingSpinner}>
        {isLoading || content === null ? (
          loadingSpinner
        ) : (
          <Editor
            content={content}
            className={editorProps.className as string | undefined}
            {...editorProps}
            onChange={readOnly ? () => {} : onChange}
            readOnly={readOnly}
          />
        )}
      </Suspense>
    </div>
  )
}
