"use client"

import { lazy, Suspense } from "react"
import type { ReactNode } from "react"
import { ConflictBanner } from "./ConflictBanner"
import type { FileConflictError } from "../../front/data/fetchClient"

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
    className?: string
    [key: string]: unknown
  }>
  /** Additional props to pass to the editor component. */
  editorProps?: Record<string, unknown>
  /** Custom loading fallback (optional). */
  loadingFallback?: ReactNode
  /** Custom error message (optional). */
  errorMessage?: string
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
  onChange,
  onReload,
  onOverwrite,
  editorComponent: Editor,
  editorProps = {},
  loadingFallback,
  errorMessage,
  className,
}: FilePaneShellProps) {
  // No file selected
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No file selected
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive text-sm">
        Failed to load file: {errorMessage ?? error.message}
      </div>
    )
  }

  const loadingSpinner = loadingFallback ?? (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <span className="animate-pulse">Loading file...</span>
    </div>
  )

  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ""}`}>
      {conflict && (
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
            onChange={onChange}
            className={editorProps.className as string | undefined}
            {...editorProps}
          />
        )}
      </Suspense>
    </div>
  )
}
