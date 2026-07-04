import { EXCEL_CLOUD_REF_SUFFIX, POWERPOINT_CLOUD_REF_SUFFIX } from "./constants"
import { SHAREPOINT_ERROR_CODES, SharePointRefValidationError } from "./errors"
import { expectedMimeTypeForOfficeKind, parseSharePointDocumentRef } from "./ref"
import type { LocalOfficeImportRequest, OfficeDocumentSubtype, SharePointDocumentRef } from "./types"

const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/
const FORBIDDEN_PATH_PATTERN = /([?&#](access_token|refresh_token|id_token|authorization|cookie)=)|Bearer\s+|token|secret|cookie|authorization/i

export function officeKindForLocalOfficePath(path: string): OfficeDocumentSubtype | null {
  if (path.endsWith(".xlsx")) return "excel"
  if (path.endsWith(".pptx")) return "powerpoint"
  return null
}

export function cloudRefPathForLocalOfficePath(path: string): string {
  const officeKind = validateLocalOfficeSourcePath(path)
  return officeKind === "excel" ? `${path}${EXCEL_CLOUD_REF_SUFFIX.slice(".xlsx".length)}` : `${path}${POWERPOINT_CLOUD_REF_SUFFIX.slice(".pptx".length)}`
}

export function validateLocalOfficeSourcePath(path: string): OfficeDocumentSubtype {
  if (typeof path !== "string" || path.length === 0) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.INVALID_REF, "sourcePath must be a non-empty workspace-relative path")
  }
  if (ABSOLUTE_PATH_PATTERN.test(path)) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.INVALID_REF, "sourcePath must be workspace-relative, not absolute")
  }
  if (path.includes("\\")) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.INVALID_REF, "sourcePath must use forward slashes")
  }
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.INVALID_REF, "sourcePath must not contain empty, dot, or traversal segments")
  }
  if (FORBIDDEN_PATH_PATTERN.test(path)) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET, "sourcePath contains forbidden credential-like data")
  }
  const officeKind = officeKindForLocalOfficePath(path)
  if (!officeKind) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.INVALID_REF, "sourcePath must end with .xlsx or .pptx")
  }
  return officeKind
}

export function buildLocalOfficeImportRef(input: {
  request: LocalOfficeImportRequest
  uploadedItem: SharePointDocumentRef
}): { ref: SharePointDocumentRef; cloudRefPath: string } {
  const officeKind = validateLocalOfficeSourcePath(input.request.sourcePath)
  const cloudRefPath = cloudRefPathForLocalOfficePath(input.request.sourcePath)
  const ref: SharePointDocumentRef = {
    ...input.uploadedItem,
    officeKind,
    mimeType: expectedMimeTypeForOfficeKind(officeKind),
    createdFrom: {
      type: "local-import",
      originalPath: input.request.sourcePath,
    },
  }
  return { ref: parseSharePointDocumentRef(ref), cloudRefPath }
}
