import { forwardRef, useCallback, useImperativeHandle, useRef } from "react"
import type { FetchClient } from "../../data/fetchClient"
import { FileUploadConflictDialog } from "./FileUploadConflictDialog"
import { FileUploadQueue } from "./FileUploadQueue"
import { useBatchFileUpload } from "./useBatchFileUpload"

export interface FileTreeUploadManagerHandle {
  open(destination: string): void
  /**
   * Queue files that arrived without the picker (an OS drag-and-drop). Same
   * queue, conflict dialog and retry path as {@link FileTreeUploadManagerHandle.open}.
   */
  addFiles(files: File[], destination: string): void
}

export const FileTreeUploadManager = forwardRef<FileTreeUploadManagerHandle, {
  client: FetchClient
  enabled: boolean
  onWritten: (destinations: string[]) => Promise<void>
}>(function FileTreeUploadManager({ client, enabled, onWritten }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  const destinationRef = useRef(".")
  const upload = useBatchFileUpload({ client, onWritten })

  useImperativeHandle(ref, () => ({
    open(destination: string) {
      if (!enabled) return
      destinationRef.current = destination
      inputRef.current?.click()
    },
    addFiles(files: File[], destination: string) {
      if (!enabled || files.length === 0) return
      upload.addFiles(files, destination)
    },
  }), [enabled, upload])

  const handleSelection = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length > 0) upload.addFiles(files, destinationRef.current)
  }, [upload])

  return (
    <>
      {enabled && (
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to upload"
          onChange={handleSelection}
        />
      )}
      <FileUploadQueue rows={upload.rows} onRetry={upload.retry} onDismiss={upload.dismiss} />
      <FileUploadConflictDialog conflict={upload.conflict} onDecision={upload.decide} />
    </>
  )
})
FileTreeUploadManager.displayName = "FileTreeUploadManager"
