import { USER_FILESYSTEM_ID } from "../../../../shared/types/filesystem"

export function shouldRedactFilesystemError(filesystem: string | undefined, status: number): boolean {
  return filesystem !== undefined && filesystem !== USER_FILESYSTEM_ID && (status === 403 || status === 404)
}

export function redactedFilesystemErrorMessage(filesystem: string | undefined, status: number, fallback: string): string {
  return shouldRedactFilesystemError(filesystem, status) ? "not found or denied" : fallback
}
