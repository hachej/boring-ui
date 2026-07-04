export const SHAREPOINT_ERROR_CODES = {
  FILE_NOT_FOUND: "SHAREPOINT_FILE_NOT_FOUND",
  INVALID_REF: "SHAREPOINT_INVALID_REF",
  REF_CONTAINS_SECRET: "SHAREPOINT_REF_CONTAINS_SECRET",
} as const

export type SharePointErrorCode = typeof SHAREPOINT_ERROR_CODES[keyof typeof SHAREPOINT_ERROR_CODES]

export class SharePointRefValidationError extends Error {
  readonly code: SharePointErrorCode

  constructor(code: SharePointErrorCode, message: string) {
    super(message)
    this.name = "SharePointRefValidationError"
    this.code = code
  }
}
