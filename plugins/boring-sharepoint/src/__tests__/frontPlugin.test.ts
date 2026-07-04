// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND, captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import sharePointPlugin from "../front"
import { OfficePreviewPanel, rawSharePointRefFileUrl, type OfficePreviewPanelParams } from "../front/panels"
import {
  BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
  EXCEL_MIME_TYPE,
  POWERPOINT_CLOUD_REF_SUFFIX,
  SHAREPOINT_ERROR_CODES,
  officeCloudRefDisplayMetadataForPath,
  type SharePointDocumentRef,
} from "../shared"

vi.mock("@hachej/boring-workspace", () => ({
  useApiBaseUrl: () => "http://workspace.test",
  useWorkspaceRequestId: () => "workspace-1",
}))

const roots: Root[] = []

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
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
  })

  it("registers only the Office cloud-ref panel and path resolver", () => {
    const captured = captureFrontPlugin(sharePointPlugin)

    expect(captured.registrations.panels.map((panel) => panel.id)).toEqual([
      BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
    ])
    expect(captured.registrations.panelCommands).toEqual([])
    expect(captured.registrations.appLeftActions).toEqual([])
    expect(captured.registrations.surfaceResolvers).toEqual([
      expect.objectContaining({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND }),
    ])
  })

  it("resolves xlsx and pptx cloud-ref paths to the Office preview panel without requiring meta", () => {
    const [resolver] = captureFrontPlugin(sharePointPlugin).registrations.surfaceResolvers

    expect(resolver.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "reports/forecast.xlsx.cloud.json" })).toEqual({
      component: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      id: "boring-sharepoint:reports/forecast.xlsx.cloud.json",
      title: "forecast.xlsx",
      params: {
        path: "reports/forecast.xlsx.cloud.json",
        officeKind: "excel",
        displayName: "forecast.xlsx",
      },
      score: 100,
    })

    expect(resolver.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "reports/forecast.xlsx.cloud.json", meta: { sharePointRef: excelRef } })).toMatchObject({
      component: BORING_SHAREPOINT_OFFICE_PREVIEW_PANEL_ID,
      params: {
        path: "reports/forecast.xlsx.cloud.json",
        sharePointRef: excelRef,
      },
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

  it("builds the same raw file URL shape as host file viewers", () => {
    expect(rawSharePointRefFileUrl("http://workspace.test/", "reports/forecast.xlsx.cloud.json")).toBe(
      "http://workspace.test/api/v1/files/raw?path=reports%2Fforecast.xlsx.cloud.json",
    )
  })

  it("self-reads a valid ref file and renders the document card", async () => {
    const fetchMock = mockFetch(JSON.stringify(excelRef))
    const container = await renderOfficePreviewPanel({
      path: "reports/forecast.xlsx.cloud.json",
      officeKind: "excel",
      displayName: "forecast.xlsx",
    })

    await waitFor(() => {
      expect(container.textContent).toContain("forecast.xlsx")
      expect(container.textContent).toContain(EXCEL_MIME_TYPE)
      expect(container.textContent).toContain(excelRef.siteId)
      expect(container.textContent).toContain(excelRef.driveId)
    })

    const link = container.querySelector<HTMLAnchorElement>("a")
    expect(link?.textContent).toContain("Open in SharePoint")
    expect(link?.getAttribute("href")).toBe(excelRef.webUrl)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://workspace.test/api/v1/files/raw?path=reports%2Fforecast.xlsx.cloud.json",
      expect.objectContaining({
        credentials: "include",
        headers: { "x-boring-workspace-id": "workspace-1" },
      }),
    )
  })

  it("uses a valid meta ref as a fast path without fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const container = await renderOfficePreviewPanel({
      path: "reports/forecast.xlsx.cloud.json",
      officeKind: "excel",
      displayName: "forecast.xlsx",
      sharePointRef: excelRef,
    })

    await waitFor(() => {
      expect(container.textContent).toContain("forecast.xlsx")
      expect(container.textContent).toContain(excelRef.driveItemId)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("renders a stable error code for invalid JSON", async () => {
    mockFetch("{not json")
    const container = await renderOfficePreviewPanel({
      path: "reports/forecast.xlsx.cloud.json",
      officeKind: "excel",
      displayName: "forecast.xlsx",
    })

    await waitFor(() => {
      expect(container.textContent).toContain(SHAREPOINT_ERROR_CODES.INVALID_REF)
      expect(container.textContent).toContain("not valid JSON")
    })
  })

  it("renders a stable error code for validation failures", async () => {
    mockFetch(JSON.stringify({ ...excelRef, driveId: "" }))
    const container = await renderOfficePreviewPanel({
      path: "reports/forecast.xlsx.cloud.json",
      officeKind: "excel",
      displayName: "forecast.xlsx",
    })

    await waitFor(() => {
      expect(container.textContent).toContain(SHAREPOINT_ERROR_CODES.INVALID_REF)
      expect(container.textContent).toContain("driveId must be a non-empty string")
    })
  })

  it("renders a stable error code when the ref file is missing", async () => {
    mockFetch("", 404)
    const container = await renderOfficePreviewPanel({
      path: "missing/forecast.xlsx.cloud.json",
      officeKind: "excel",
      displayName: "forecast.xlsx",
    })

    await waitFor(() => {
      expect(container.textContent).toContain(SHAREPOINT_ERROR_CODES.FILE_NOT_FOUND)
      expect(container.textContent).toContain("HTTP 404")
    })
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

async function renderOfficePreviewPanel(params: OfficePreviewPanelParams): Promise<HTMLElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(React.createElement(OfficePreviewPanel, { params } as Parameters<typeof OfficePreviewPanel>[0]))
  })
  return container
}

function mockFetch(body: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function waitFor(assertion: () => void): Promise<void> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < 1000) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}
