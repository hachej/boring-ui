import { WORKSPACE_OPEN_PATH_SURFACE_KIND, captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { describe, expect, it } from "vitest"
import sharePointPlugin from "../front"
import {
  BORING_SHAREPOINT_APP_LEFT_ACTION_ID,
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  BORING_SHAREPOINT_SETTINGS_COMMAND_ID,
  BORING_SHAREPOINT_SETTINGS_PANEL_ID,
  EXCEL_MIME_TYPE,
  POWERPOINT_CLOUD_REF_SUFFIX,
  officeCloudRefDisplayMetadataForPath,
  type SharePointDocumentRef,
} from "../shared"

const excelRef: SharePointDocumentRef = {
  kind: "office-cloud-document",
  provider: "sharepoint",
  version: 1,
  name: "forecast.xlsx",
  officeKind: "excel",
  mimeType: EXCEL_MIME_TYPE,
  webUrl: "https://tenant.sharepoint.com/sites/team/Shared%20Documents/forecast.xlsx",
  siteId: "tenant.sharepoint.com,site-id,web-id",
  driveId: "drive-id",
  driveItemId: "item-id",
}

describe("SharePoint front plugin", () => {
  it("registers Office preview, settings command, app-left settings, and path resolver", () => {
    const captured = captureFrontPlugin(sharePointPlugin)

    expect(captured.registrations.panels.map((panel) => panel.id)).toEqual([
      BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      BORING_SHAREPOINT_SETTINGS_PANEL_ID,
    ])
    expect(captured.registrations.panelCommands).toEqual([
      expect.objectContaining({
        id: BORING_SHAREPOINT_SETTINGS_COMMAND_ID,
        panelId: BORING_SHAREPOINT_SETTINGS_PANEL_ID,
      }),
    ])
    expect(captured.registrations.appLeftActions).toEqual([
      expect.objectContaining({ id: BORING_SHAREPOINT_APP_LEFT_ACTION_ID, label: "SharePoint" }),
    ])
    expect(captured.registrations.surfaceResolvers).toEqual([
      expect.objectContaining({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND }),
    ])
  })

  it("resolves xlsx and pptx cloud-ref paths to the Office preview panel", () => {
    const [resolver] = captureFrontPlugin(sharePointPlugin).registrations.surfaceResolvers

    expect(resolver.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "reports/forecast.xlsx.cloud.json", meta: { sharePointRef: excelRef } })).toEqual({
      component: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      id: "boring-sharepoint:reports/forecast.xlsx.cloud.json",
      title: "forecast.xlsx",
      params: {
        path: "reports/forecast.xlsx.cloud.json",
        officeKind: "excel",
        displayName: "forecast.xlsx",
        webUrl: excelRef.webUrl,
      },
      score: 100,
    })

    expect(resolver.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: `slides/roadmap${POWERPOINT_CLOUD_REF_SUFFIX}` })).toMatchObject({
      component: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      title: "roadmap.pptx",
      params: {
        path: `slides/roadmap${POWERPOINT_CLOUD_REF_SUFFIX}`,
        officeKind: "powerpoint",
        displayName: "roadmap.pptx",
      },
    })
    expect(resolver.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "notes.md" })).toBeUndefined()
  })

  it("derives virtual display metadata without reading provider state", () => {
    expect(officeCloudRefDisplayMetadataForPath("nested/report.xlsx.cloud.json")).toEqual({
      cloudRefPath: "nested/report.xlsx.cloud.json",
      officeKind: "excel",
      displayName: "report.xlsx",
      title: "report.xlsx",
    })
    expect(officeCloudRefDisplayMetadataForPath("notes.md")).toBeNull()
  })
})
