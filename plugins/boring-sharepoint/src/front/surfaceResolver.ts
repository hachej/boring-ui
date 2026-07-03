import { WORKSPACE_OPEN_PATH_SURFACE_KIND, type BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import {
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  EXCEL_CLOUD_REF_SUFFIX,
  POWERPOINT_CLOUD_REF_SUFFIX,
  isSharePointDocumentRef,
  officeCloudRefDisplayMetadataForPath,
} from "../shared"
import type { OfficePreviewPanelParams } from "./panels"

export const sharePointOfficeCloudRefSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "boring-sharepoint.office-cloud-ref",
  kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  title: "SharePoint Office cloud reference",
  description: "Opens SharePoint-backed Excel and PowerPoint cloud reference files in the SharePoint preview panel.",
  targetHint: `*${EXCEL_CLOUD_REF_SUFFIX} or *${POWERPOINT_CLOUD_REF_SUFFIX}`,
  examples: [
    { target: `reports/forecast${EXCEL_CLOUD_REF_SUFFIX}`, label: "Excel cloud ref" },
    { target: `decks/roadmap${POWERPOINT_CLOUD_REF_SUFFIX}`, label: "PowerPoint cloud ref" },
  ],
  resolve(request) {
    const metadata = officeCloudRefDisplayMetadataForPath(request.target)
    if (!metadata) return undefined

    const params: OfficePreviewPanelParams = {
      path: metadata.cloudRefPath,
      officeKind: metadata.officeKind,
      displayName: metadata.displayName,
    }

    const ref = request.meta?.sharePointRef
    if (isSharePointDocumentRef(ref)) params.webUrl = ref.webUrl

    return {
      component: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      id: `boring-sharepoint:${metadata.cloudRefPath}`,
      title: metadata.title,
      params: params as unknown as Record<string, unknown>,
      score: 100,
    }
  },
}
