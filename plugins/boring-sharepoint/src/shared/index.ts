export {
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
  EXCEL_CLOUD_REF_SUFFIX,
  EXCEL_MIME_TYPE,
  OFFICE_CLOUD_DOCUMENT_KIND,
  POWERPOINT_CLOUD_REF_SUFFIX,
  POWERPOINT_MIME_TYPE,
  SHAREPOINT_PROVIDER_ID,
} from "./constants"
export { officeCloudRefDisplayMetadataForPath, officeKindDisplayLabel, sharePointDriveDisplayLabel, sharePointSiteDisplayLabel } from "./display"
export type { OfficeCloudRefDisplayMetadata } from "./display"
export { buildLocalOfficeImportRef, cloudRefPathForLocalOfficePath, officeKindForLocalOfficePath, validateLocalOfficeSourcePath } from "./import"
export { SHAREPOINT_ERROR_CODES, SharePointRefValidationError } from "./errors"
export type { SharePointErrorCode } from "./errors"
export {
  assertSharePointDocumentRefSafeForStorage,
  expectedMimeTypeForOfficeKind,
  isSharePointDocumentRef,
  officeKindForCloudRefPath,
  parseSharePointDocumentRef,
  parseSharePointDocumentRefJson,
  validateSharePointDocumentRef,
} from "./ref"
export type { SharePointRefValidationResult } from "./ref"
export type {
  LocalOfficeImportRequest,
  LocalOfficeImportResult,
  LocalOfficeImportTarget,
  OfficeDocumentSubtype,
  SharePointDocumentRef,
  SharePointDocumentRefCreatedFrom,
} from "./types"
