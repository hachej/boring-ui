import { EXCEL_CLOUD_REF_SUFFIX, POWERPOINT_CLOUD_REF_SUFFIX } from "./constants"
import { officeKindForCloudRefPath } from "./ref"
import type { OfficeDocumentSubtype, SharePointDocumentRef } from "./types"

export interface OfficeCloudRefDisplayMetadata {
  cloudRefPath: string
  officeKind: OfficeDocumentSubtype
  displayName: string
  title: string
}

export function officeCloudRefDisplayMetadataForPath(path: string): OfficeCloudRefDisplayMetadata | null {
  const officeKind = officeKindForCloudRefPath(path)
  if (!officeKind) return null

  const suffix = officeKind === "excel" ? EXCEL_CLOUD_REF_SUFFIX : POWERPOINT_CLOUD_REF_SUFFIX
  const fileName = path.split(/[\\/]/).pop() ?? path
  const displayName = fileName.endsWith(suffix) ? fileName.slice(0, -".cloud.json".length) : fileName

  return {
    cloudRefPath: path,
    officeKind,
    displayName,
    title: displayName,
  }
}

export function officeKindDisplayLabel(kind: OfficeDocumentSubtype): string {
  return kind === "excel" ? "Excel workbook" : "PowerPoint deck"
}

export function sharePointSiteDisplayLabel(ref: SharePointDocumentRef): string {
  return ref.siteId
}

export function sharePointDriveDisplayLabel(ref: SharePointDocumentRef): string {
  return ref.driveId
}
