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
