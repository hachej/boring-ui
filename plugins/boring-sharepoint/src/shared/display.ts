import { EXCEL_CLOUD_REF_SUFFIX, POWERPOINT_CLOUD_REF_SUFFIX } from "./constants"
import { officeKindForCloudRefPath } from "./ref"
import type { OfficeDocumentSubtype } from "./types"

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
