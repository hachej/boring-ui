import { describe, expect, it, vi } from "vitest"
import {
  EXCEL_MIME_TYPE,
  POWERPOINT_MIME_TYPE,
  SHAREPOINT_ERROR_CODES,
  type SharePointProviderContext,
} from "../shared"
import { ARCADE_SHAREPOINT_TOOL_NAMES, ArcadeSharePointProvider, SharePointProviderError } from "../server/sharePointProvider"

const ctx: SharePointProviderContext = { workspaceId: "workspace-1", actorUserId: "julien.hurault@sumeo.io" }

const siteValue = {
  id: "sumeo662.sharepoint.com,e8043020-774d-46ed-926c-f52c073140a1,92442a3f-a894-4bce-9e6b-895550db0275",
  webUrl: "https://sumeo662.sharepoint.com/sites/sumeotest",
}

const xlsxItemValue = {
  id: "01ROJOXDN53PWGVAWEJREZKIIY4VGYDIZ5",
  name: "tttt.xlsx",
  webUrl: "https://sumeo662.sharepoint.com/sites/sumeotest/Shared%20Documents/tttt.xlsx",
  parentReference: {
    driveId: "b!IDAE6E137UaSbPUsBzFAoT8qRJKUqM5LnmuJVVDbAnUI5HkM_PyuQovkEHDyaz3G",
    siteId: siteValue.id,
  },
  file: { mimeType: EXCEL_MIME_TYPE },
}

const xlsxRef = {
  kind: "office-cloud-document" as const,
  provider: "sharepoint" as const,
  version: 1 as const,
  name: xlsxItemValue.name,
  officeKind: "excel" as const,
  mimeType: EXCEL_MIME_TYPE,
  webUrl: xlsxItemValue.webUrl,
  siteId: siteValue.id,
  driveId: xlsxItemValue.parentReference.driveId,
  driveItemId: xlsxItemValue.id,
}

const pptxItemValue = {
  id: "01ROJOXDM7345DEYRHSFE2K7NEHOW6X3P2",
  name: "tttt.pptx",
  web_url: "https://sumeo662.sharepoint.com/sites/sumeotest/Shared%20Documents/tttt.pptx",
  parent_reference: {
    drive_id: "b!IDAE6E137UaSbPUsBzFAoT8qRJKUqM5LnmuJVVDbAnUI5HkM_PyuQovkEHDyaz3G",
    site_id: siteValue.id,
  },
  file: { mime_type: POWERPOINT_MIME_TYPE },
}

const pptxRef = {
  kind: "office-cloud-document" as const,
  provider: "sharepoint" as const,
  version: 1 as const,
  name: pptxItemValue.name,
  officeKind: "powerpoint" as const,
  mimeType: POWERPOINT_MIME_TYPE,
  webUrl: pptxItemValue.web_url,
  siteId: siteValue.id,
  driveId: pptxItemValue.parent_reference.drive_id,
  driveItemId: pptxItemValue.id,
}

describe("ArcadeSharePointProvider", () => {
  it("normalizes read-only status through the Arcade runtime", async () => {
    const executeTool = vi.fn().mockResolvedValue({ success: true, output: { value: [] } })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(provider.getStatus(ctx)).resolves.toEqual({ status: "connected" })
    expect(executeTool).toHaveBeenCalledWith({
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.statusProbe,
      userId: ctx.actorUserId,
      input: {},
    })
  })

  it("starts authorization through the Arcade runtime with read-only scopes", async () => {
    const startAuthorization = vi.fn().mockResolvedValue({ status: "not_started", url: "https://arcade.dev/auth" })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool: vi.fn(), startAuthorization } })

    await expect(provider.authorize(ctx)).resolves.toEqual({ status: "needs_auth", authorizationUrl: "https://arcade.dev/auth" })
    expect(startAuthorization).toHaveBeenCalledWith({ userId: ctx.actorUserId, scopes: ["Sites.Read.All", "Files.Read.All"] })
  })

  it("resolves a SharePoint site URL and Excel webUrl into a canonical cloud ref", async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ success: true, output: { value: siteValue } })
      .mockResolvedValueOnce({ success: true, output: { value: xlsxItemValue } })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(
      provider.resolveDriveItem(
        { siteUrl: "https://sumeo662.sharepoint.com/sites/sumeotest", webUrl: xlsxItemValue.webUrl },
        ctx,
      ),
    ).resolves.toEqual({
      kind: "office-cloud-document",
      provider: "sharepoint",
      version: 1,
      name: "tttt.xlsx",
      officeKind: "excel",
      mimeType: EXCEL_MIME_TYPE,
      webUrl: xlsxItemValue.webUrl,
      siteId: siteValue.id,
      driveId: xlsxItemValue.parentReference.driveId,
      driveItemId: xlsxItemValue.id,
      createdFrom: { type: "sharepoint" },
    })
    expect(executeTool).toHaveBeenNthCalledWith(1, {
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.getSite,
      userId: ctx.actorUserId,
      input: { site: "https://sumeo662.sharepoint.com/sites/sumeotest" },
    })
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.getDriveItemByUrl,
      userId: ctx.actorUserId,
      input: { web_url: xlsxItemValue.webUrl },
    })
  })

  it("resolves PowerPoint metadata from durable drive id + item id", async () => {
    const executeTool = vi.fn().mockResolvedValue({ success: true, output: { value: pptxItemValue } })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    const ref = await provider.resolveDriveItem({ driveId: pptxItemValue.parent_reference.drive_id, driveItemId: pptxItemValue.id }, ctx)

    expect(ref).toMatchObject({
      name: "tttt.pptx",
      officeKind: "powerpoint",
      mimeType: POWERPOINT_MIME_TYPE,
      webUrl: pptxItemValue.web_url,
      siteId: siteValue.id,
      driveId: pptxItemValue.parent_reference.drive_id,
      driveItemId: pptxItemValue.id,
    })
    expect(JSON.stringify(ref)).not.toMatch(/preview|getUrl|access_token|Bearer/i)
    expect(executeTool).toHaveBeenCalledWith({
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.getDriveItem,
      userId: ctx.actorUserId,
      input: { drive_id: pptxItemValue.parent_reference.drive_id, item_id: pptxItemValue.id },
    })
  })

  it("creates a transient Office preview URL through the custom Arcade tool", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      output: { value: { getUrl: "https://tenant.sharepoint.com/:x:/preview.aspx?token=transient", expiresAt: "2026-07-03T15:00:00Z" } },
    })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(provider.createOfficePreviewUrl({ ...xlsxItemValue, kind: "office-cloud-document", provider: "sharepoint", version: 1, officeKind: "excel", mimeType: EXCEL_MIME_TYPE, siteId: siteValue.id, driveId: xlsxItemValue.parentReference.driveId, driveItemId: xlsxItemValue.id }, ctx)).resolves.toEqual({
      getUrl: "https://tenant.sharepoint.com/:x:/preview.aspx?token=transient",
      expiresAt: "2026-07-03T15:00:00Z",
    })
    expect(executeTool).toHaveBeenCalledWith({
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.createPreviewUrl,
      userId: ctx.actorUserId,
      input: { drive_id: xlsxItemValue.parentReference.driveId, item_id: xlsxItemValue.id, viewer: "office" },
    })
  })

  it("rejects missing or non-HTTPS preview URLs without echoing returned URL data", async () => {
    const providerWithPreview = (value: Record<string, unknown>) =>
      new ArcadeSharePointProvider({
        runtime: { executeTool: vi.fn().mockResolvedValue({ success: true, output: { value } }), startAuthorization: vi.fn() },
      })

    await expect(providerWithPreview({}).createOfficePreviewUrl({ driveId: "drive-id", driveItemId: "item-id" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE,
      message: expect.not.stringContaining("http://tenant/preview"),
    })
    await expect(providerWithPreview({ getUrl: "http://tenant/preview" }).createOfficePreviewUrl({ driveId: "drive-id", driveItemId: "item-id" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE,
      message: expect.not.stringContaining("http://tenant/preview"),
    })
  })

  it("adds an Excel worksheet through Arcade and returns a sanitized edit result", async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ success: true, output: { value: { session_id: "session-123" } } })
      .mockResolvedValueOnce({ success: true, output: { value: { workbook: { worksheets: ["Forecast"] }, getUrl: "https://tenant/preview?token=raw" } } })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(provider.editOfficeDocument(xlsxRef, { kind: "excel.add-worksheet", worksheetName: "Forecast" }, ctx)).resolves.toEqual({
      status: "succeeded",
      summary: "Added worksheet Forecast to tttt.xlsx",
      sessionId: "session-123",
    })
    expect(executeTool).toHaveBeenNthCalledWith(1, {
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.addWorksheet,
      userId: ctx.actorUserId,
      input: { drive_id: xlsxRef.driveId, item_id: xlsxRef.driveItemId, worksheet_name: "Forecast" },
    })
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.getWorkbookMetadata,
      userId: ctx.actorUserId,
      input: { drive_id: xlsxRef.driveId, item_id: xlsxRef.driveItemId, session_id: "session-123" },
    })
  })

  it("creates a PowerPoint slide through the assumed Arcade SharePoint tool", async () => {
    const executeTool = vi.fn().mockResolvedValue({ success: true, output: { value: { slideId: "slide-1", previewUrl: "https://tenant/preview?token=raw" } } })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(
      provider.editOfficeDocument(
        pptxRef,
        { kind: "powerpoint.create-slide", title: "Q3 update", body: "Revenue improved.", layout: "TITLE_AND_CONTENT" },
        ctx,
      ),
    ).resolves.toEqual({ status: "succeeded", summary: "Created PowerPoint slide in tttt.pptx" })
    expect(executeTool).toHaveBeenCalledWith({
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.createSlide,
      userId: ctx.actorUserId,
      input: {
        drive_id: pptxRef.driveId,
        item_id: pptxRef.driveItemId,
        title: "Q3 update",
        body: "Revenue improved.",
        layout: "TITLE_AND_CONTENT",
      },
    })
  })

  it("rejects Office edit kind/ref mismatches before Arcade calls", async () => {
    const executeTool = vi.fn()
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(provider.editOfficeDocument(xlsxRef, { kind: "powerpoint.create-slide", title: "Wrong file" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.EDIT_CONFLICT,
    } satisfies Partial<SharePointProviderError>)
    await expect(provider.editOfficeDocument(pptxRef, { kind: "excel.add-worksheet", worksheetName: "Wrong" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.EDIT_CONFLICT,
    } satisfies Partial<SharePointProviderError>)
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("rejects invalid Office edit fields before Arcade calls", async () => {
    const executeTool = vi.fn()
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(provider.editOfficeDocument(xlsxRef, { kind: "excel.add-worksheet", worksheetName: "" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.INVALID_REF,
    } satisfies Partial<SharePointProviderError>)
    await expect(provider.editOfficeDocument(xlsxRef, { kind: "excel.add-worksheet", worksheetName: "x".repeat(32) }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.INVALID_REF,
    } satisfies Partial<SharePointProviderError>)
    await expect(provider.editOfficeDocument(xlsxRef, { kind: "excel.add-worksheet", worksheetName: ` ${"x".repeat(31)} ` }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.INVALID_REF,
    } satisfies Partial<SharePointProviderError>)
    await expect(provider.editOfficeDocument(pptxRef, { kind: "powerpoint.create-slide", title: "Bearer secret-token" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET,
    } satisfies Partial<SharePointProviderError>)
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("imports local Excel and PowerPoint documents through the Arcade upload tool", async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ success: true, output: { value: xlsxItemValue } })
      .mockResolvedValueOnce({ success: true, output: { value: pptxItemValue } })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(
      provider.importLocalOfficeDocument(
        {
          sourcePath: "reports/forecast.xlsx",
          contentHandle: "staged-upload-1",
          target: { siteUrl: siteValue.webUrl, driveId: xlsxRef.driveId, folderDriveItemId: "folder-1" },
        },
        ctx,
      ),
    ).resolves.toEqual({
      ref: { ...xlsxRef, createdFrom: { type: "local-import", originalPath: "reports/forecast.xlsx" } },
      cloudRefPath: "reports/forecast.xlsx.cloud.json",
    })

    await expect(
      provider.importLocalOfficeDocument(
        {
          sourcePath: "decks/roadmap.pptx",
          contentHandle: "staged-upload-2",
          target: { folderWebUrl: "https://sumeo662.sharepoint.com/sites/sumeotest/Shared%20Documents" },
        },
        ctx,
      ),
    ).resolves.toEqual({
      ref: { ...pptxRef, createdFrom: { type: "local-import", originalPath: "decks/roadmap.pptx" } },
      cloudRefPath: "decks/roadmap.pptx.cloud.json",
    })

    expect(executeTool).toHaveBeenNthCalledWith(1, {
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.uploadOfficeDocument,
      userId: ctx.actorUserId,
      input: {
        source_path: "reports/forecast.xlsx",
        content_handle: "staged-upload-1",
        name: "forecast.xlsx",
        mime_type: EXCEL_MIME_TYPE,
        site_url: siteValue.webUrl,
        drive_id: xlsxRef.driveId,
        folder_item_id: "folder-1",
      },
    })
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      toolName: ARCADE_SHAREPOINT_TOOL_NAMES.uploadOfficeDocument,
      userId: ctx.actorUserId,
      input: {
        source_path: "decks/roadmap.pptx",
        content_handle: "staged-upload-2",
        name: "roadmap.pptx",
        mime_type: POWERPOINT_MIME_TYPE,
        folder_web_url: "https://sumeo662.sharepoint.com/sites/sumeotest/Shared%20Documents",
      },
    })
  })

  it("rejects unsafe local import requests before Arcade calls", async () => {
    const executeTool = vi.fn()
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    const invalidRequests = [
      { sourcePath: "/tmp/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: xlsxRef.driveId } },
      { sourcePath: "../forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: xlsxRef.driveId } },
      { sourcePath: "reports/notes.docx", contentHandle: "staged-upload-1", target: { driveId: xlsxRef.driveId } },
      { sourcePath: "reports/token-secret.xlsx", contentHandle: "staged-upload-1", target: { driveId: xlsxRef.driveId } },
      { sourcePath: "reports/forecast.xlsx", contentHandle: "Bearer secret", target: { driveId: xlsxRef.driveId } },
      { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: `${xlsxRef.driveId}?access_token=secret` } },
      { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: {} },
    ]

    for (const request of invalidRequests) {
      await expect(provider.importLocalOfficeDocument(request, ctx)).rejects.toBeInstanceOf(SharePointProviderError)
    }
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("rejects mismatched Office extension and MIME metadata with a stable code", async () => {
    const providerWithItem = (item: Record<string, unknown>) =>
      new ArcadeSharePointProvider({
        runtime: {
          executeTool: vi.fn().mockResolvedValue({ success: true, output: { value: item } }),
          startAuthorization: vi.fn(),
        },
      })

    await expect(
      providerWithItem({ ...xlsxItemValue, name: "notes.docx", file: { mimeType: EXCEL_MIME_TYPE } }).resolveDriveItem(
        { webUrl: "https://tenant/notes.docx" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: SHAREPOINT_ERROR_CODES.INVALID_REF } satisfies Partial<SharePointProviderError>)

    await expect(
      providerWithItem({ ...xlsxItemValue, file: { mimeType: POWERPOINT_MIME_TYPE } }).resolveDriveItem({ webUrl: xlsxItemValue.webUrl }, ctx),
    ).rejects.toMatchObject({ code: SHAREPOINT_ERROR_CODES.INVALID_REF } satisfies Partial<SharePointProviderError>)
  })

  it("rejects unsupported SharePoint file types with a stable code", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      output: { value: { ...xlsxItemValue, name: "notes.docx", file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } } },
    })
    const provider = new ArcadeSharePointProvider({ runtime: { executeTool, startAuthorization: vi.fn() } })

    await expect(provider.resolveDriveItem({ webUrl: "https://tenant/notes.docx" }, ctx)).rejects.toMatchObject({
      code: SHAREPOINT_ERROR_CODES.INVALID_REF,
    } satisfies Partial<SharePointProviderError>)
  })
})
