"use client"

import { Button, Notice } from "@hachej/boring-ui-kit"
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
    <Notice
      role="alert"
      tone="accent"
      className="rounded-none border-x-0 border-t-0"
      description={
        <>
          This file has been modified outside the editor. Your unsaved changes
          will be lost if you reload, or will overwrite the latest version on
          disk if you save.
        </>
      }
      actions={
        <>
          <Button type="button" variant="outline" size="xs" onClick={() => void onReload()}>
            Reload
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() => void onOverwrite()}
          >
            Overwrite
          </Button>
          {/* The path is in the error for logging — show it on hover so the
              banner stays compact in narrow panes. */}
          <span className="sr-only">{conflict.path}</span>
        </>
      }
    />
  )
}
