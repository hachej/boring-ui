"use client"

import { FileConflictError } from "./data/fetchClient"

export interface ConflictBannerProps {
  conflict: FileConflictError
  onReload: () => void | Promise<void>
  onOverwrite: () => void | Promise<void>
}

/**
 * Shared conflict banner for file panes.
 *
 * Shown when a file has been modified externally (OCC conflict).
 * Offers two choices: reload from server (discard local changes) or
 * overwrite server (force save local changes).
 */
export function ConflictBanner({ conflict, onReload, onOverwrite }: ConflictBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200"
    >
      <span className="flex-1">
        This file has been modified outside the editor. Your unsaved changes
        will be lost if you reload, or will overwrite the latest version on
        disk if you save.
      </span>
      <button
        type="button"
        onClick={() => void onReload()}
        className="rounded-sm border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-xs hover:bg-amber-500/30"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => void onOverwrite()}
        className="rounded-sm border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/25"
      >
        Overwrite
      </button>
      {/* The path is in the error for logging — show it on hover so the
          banner stays compact in narrow panes. */}
      <span className="sr-only">{conflict.path}</span>
    </div>
  )
}
