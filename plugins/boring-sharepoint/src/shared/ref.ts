import {
  EXCEL_CLOUD_REF_SUFFIX,
  EXCEL_MIME_TYPE,
  OFFICE_CLOUD_DOCUMENT_KIND,
  POWERPOINT_CLOUD_REF_SUFFIX,
  POWERPOINT_MIME_TYPE,
  SHAREPOINT_PROVIDER_ID,
} from "./constants"
import { SHAREPOINT_ERROR_CODES, SharePointRefValidationError } from "./errors"
import type { OfficeDocumentSubtype, SharePointDocumentRef } from "./types"

type JsonObject = Record<string, unknown>

const FORBIDDEN_KEY_PATTERN = /(^|_)(access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|cookie|authorization|preview[_-]?url|get[_-]?url|post[_-]?url|wopi[_-]?token)($|_)/i
const FORBIDDEN_STRING_PATTERN = /([?&#](access_token|refresh_token|id_token|wopiToken|authorization|cookie)=)|Bearer\s+[A-Za-z0-9._~+/-]+=*/i
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/

export interface SharePointRefValidationResult {
  ok: boolean
  errors: string[]
  containsForbiddenData?: boolean
}

export function officeKindForCloudRefPath(path: string): OfficeDocumentSubtype | null {
  if (path.endsWith(EXCEL_CLOUD_REF_SUFFIX)) return "excel"
  if (path.endsWith(POWERPOINT_CLOUD_REF_SUFFIX)) return "powerpoint"
  return null
}

export function expectedMimeTypeForOfficeKind(kind: OfficeDocumentSubtype): string {
  return kind === "excel" ? EXCEL_MIME_TYPE : POWERPOINT_MIME_TYPE
}

export function isSharePointDocumentRef(value: unknown): value is SharePointDocumentRef {
  return validateSharePointDocumentRef(value).ok
}

export function parseSharePointDocumentRefJson(json: string): SharePointDocumentRef {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new SharePointRefValidationError(
      SHAREPOINT_ERROR_CODES.INVALID_REF,
      `SharePoint document ref is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    )
  }
  return parseSharePointDocumentRef(parsed)
}

export function parseSharePointDocumentRef(value: unknown): SharePointDocumentRef {
  const result = validateSharePointDocumentRef(value)
  if (!result.ok) {
    throw new SharePointRefValidationError(
      result.containsForbiddenData ? SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET : SHAREPOINT_ERROR_CODES.INVALID_REF,
      result.errors.join("; "),
    )
  }
  return value as SharePointDocumentRef
}

export function validateSharePointDocumentRef(value: unknown): SharePointRefValidationResult {
  const errors: string[] = []

  if (!isObject(value)) {
    return { ok: false, errors: ["ref must be an object"] }
  }

  const forbiddenStart = errors.length
  collectForbiddenRefData(value, errors)
  const containsForbiddenData = errors.length > forbiddenStart

  expectLiteral(value, "kind", OFFICE_CLOUD_DOCUMENT_KIND, errors)
  expectLiteral(value, "provider", SHAREPOINT_PROVIDER_ID, errors)
  expectLiteral(value, "version", 1, errors)
  expectNonEmptyString(value, "name", errors)
  expectNonEmptyString(value, "mimeType", errors)
  expectNonEmptyString(value, "webUrl", errors)
  expectNonEmptyString(value, "siteId", errors)
  expectNonEmptyString(value, "driveId", errors)
  expectNonEmptyString(value, "driveItemId", errors)

  const officeKind = value.officeKind
  if (officeKind !== "excel" && officeKind !== "powerpoint") {
    errors.push("officeKind must be \"excel\" or \"powerpoint\"")
  } else if (value.mimeType !== expectedMimeTypeForOfficeKind(officeKind)) {
    errors.push(`mimeType must match officeKind ${officeKind}`)
  }

  if (typeof value.name === "string") {
    if (officeKind === "excel" && !value.name.endsWith(".xlsx")) errors.push("excel refs must use a .xlsx name")
    if (officeKind === "powerpoint" && !value.name.endsWith(".pptx")) errors.push("powerpoint refs must use a .pptx name")
  }

  if (typeof value.webUrl === "string" && !isHttpsUrl(value.webUrl)) {
    errors.push("webUrl must be an https URL")
  }

  if (value.createdFrom !== undefined) {
    if (!isObject(value.createdFrom)) {
      errors.push("createdFrom must be an object when provided")
    } else {
      const createdFrom = value.createdFrom
      if (createdFrom.type !== "local-import" && createdFrom.type !== "sharepoint") {
        errors.push("createdFrom.type must be \"local-import\" or \"sharepoint\"")
      }
      if (createdFrom.originalPath !== undefined) {
        if (typeof createdFrom.originalPath !== "string" || createdFrom.originalPath.length === 0) {
          errors.push("createdFrom.originalPath must be a non-empty string when provided")
        } else if (ABSOLUTE_PATH_PATTERN.test(createdFrom.originalPath)) {
          errors.push("createdFrom.originalPath must be workspace-relative, not absolute")
        }
      }
    }
  }

  return containsForbiddenData
    ? { ok: errors.length === 0, errors, containsForbiddenData }
    : { ok: errors.length === 0, errors }
}

export function assertSharePointDocumentRefSafeForStorage(ref: unknown): void {
  const errors: string[] = []
  collectForbiddenRefData(ref, errors)
  if (errors.length > 0) {
    throw new SharePointRefValidationError(SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET, errors.join("; "))
  }
}

function collectForbiddenRefData(value: unknown, errors: string[], path = "ref"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenRefData(entry, errors, `${path}[${index}]`))
    return
  }
  if (!isObject(value)) {
    if (typeof value === "string" && FORBIDDEN_STRING_PATTERN.test(value)) {
      errors.push(`${path} contains token-bearing data`)
    }
    return
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      errors.push(`${nestedPath} is not allowed in a stored SharePoint ref`)
    }
    collectForbiddenRefData(nested, errors, nestedPath)
  }
}

function expectLiteral(object: JsonObject, key: string, expected: string | number, errors: string[]): void {
  if (object[key] !== expected) errors.push(`${key} must be ${JSON.stringify(expected)}`)
}

function expectNonEmptyString(object: JsonObject, key: string, errors: string[]): void {
  if (typeof object[key] !== "string" || object[key].length === 0) {
    errors.push(`${key} must be a non-empty string`)
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
