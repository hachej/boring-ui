export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_CONCURRENT_FILE_UPLOADS = 3

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "skipped" | "canceled"
export type ConflictDecision = "replace" | "skip" | "cancel"

export interface UploadQueueRow {
  id: string
  file: File
  destination: string
  path: string
  status: UploadStatus
  message?: string
  retryable?: boolean
}

export interface UploadConflictState {
  rows: UploadQueueRow[]
}
