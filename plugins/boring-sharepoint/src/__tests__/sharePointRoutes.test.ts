import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EXCEL_MIME_TYPE, POWERPOINT_MIME_TYPE, SHAREPOINT_ERROR_CODES, type SharePointProvider } from "../shared"
import { SHAREPOINT_ROUTE_PATHS, sharePointRoutes } from "../server/routes"
import { SharePointProviderError } from "../server/sharePointProvider"

const apps: Array<ReturnType<typeof Fastify>> = []

const ref = {
  kind: "office-cloud-document" as const,
  provider: "sharepoint" as const,
  version: 1 as const,
  name: "tttt.xlsx",
  officeKind: "excel" as const,
  mimeType: EXCEL_MIME_TYPE,
  webUrl: "https://sumeo662.sharepoint.com/sites/sumeotest/Shared%20Documents/tttt.xlsx",
  siteId: "sumeo662.sharepoint.com,e8043020-774d-46ed-926c-f52c073140a1,92442a3f-a894-4bce-9e6b-895550db0275",
  driveId: "b!IDAE6E137UaSbPUsBzFAoT8qRJKUqM5LnmuJVVDbAnUI5HkM_PyuQovkEHDyaz3G",
  driveItemId: "01ROJOXDN53PWGVAWEJREZKIIY4VGYDIZ5",
  createdFrom: { type: "sharepoint" as const },
}

const pptxRef = {
  ...ref,
  name: "tttt.pptx",
  officeKind: "powerpoint" as const,
  mimeType: POWERPOINT_MIME_TYPE,
  webUrl: "https://sumeo662.sharepoint.com/sites/sumeotest/Shared%20Documents/tttt.pptx",
  driveItemId: "01ROJOXDM7345DEYRHSFE2K7NEHOW6X3P2",
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SharePoint routes", () => {
  it("returns stable status JSON from the provider", async () => {
    const provider = fakeProvider({ getStatus: vi.fn().mockResolvedValue({ status: "connected" }) })
    const app = await testApp(provider)

    const response = await app.inject({ method: "GET", url: SHAREPOINT_ROUTE_PATHS.status })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: { status: "connected" } })
    expect(provider.getStatus).toHaveBeenCalledWith({ workspaceId: "default", actorUserId: "anonymous" })
  })

  it("strips authorization URLs from status route responses", async () => {
    const provider = fakeProvider({ getStatus: vi.fn().mockResolvedValue({ status: "needs_auth", authorizationUrl: "https://arcade.dev/auth?token=secret" }) })
    const app = await testApp(provider)

    const response = await app.inject({ method: "GET", url: SHAREPOINT_ROUTE_PATHS.status })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: { status: "needs_auth" } })
    expect(response.body).not.toMatch(/arcade\.dev|token=secret|authorizationUrl/i)
  })

  it("returns canonical ref metadata only from resolve", async () => {
    const provider = fakeProvider({ resolveDriveItem: vi.fn().mockResolvedValue(ref) })
    const app = await testApp(provider)

    const response = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.resolve,
      payload: { webUrl: ref.webUrl },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ref })
    expect(response.body).not.toMatch(/preview|getUrl|access_token|Bearer/i)
    expect(provider.resolveDriveItem).toHaveBeenCalledWith(
      { siteUrl: undefined, webUrl: ref.webUrl, driveId: undefined, driveItemId: undefined },
      { workspaceId: "default", actorUserId: "anonymous" },
    )
  })

  it("returns transient preview result without persisting ref metadata", async () => {
    const provider = fakeProvider({ createOfficePreviewUrl: vi.fn().mockResolvedValue({ getUrl: "https://tenant.sharepoint.com/preview?token=transient" }) })
    const app = await testApp(provider)

    const response = await app.inject({ method: "POST", url: SHAREPOINT_ROUTE_PATHS.preview, payload: { ref } })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ getUrl: "https://tenant.sharepoint.com/preview?token=transient" })
    expect(response.json()).not.toHaveProperty("ref")
    expect(provider.createOfficePreviewUrl).toHaveBeenCalledWith(ref, { workspaceId: "default", actorUserId: "anonymous" })
  })

  it("accepts durable drive identity for preview requests", async () => {
    const provider = fakeProvider({ createOfficePreviewUrl: vi.fn().mockResolvedValue({ getUrl: "https://tenant.sharepoint.com/preview" }) })
    const app = await testApp(provider)

    const response = await app.inject({ method: "POST", url: SHAREPOINT_ROUTE_PATHS.preview, payload: { driveId: ref.driveId, driveItemId: ref.driveItemId } })

    expect(response.statusCode).toBe(200)
    expect(provider.createOfficePreviewUrl).toHaveBeenCalledWith(
      { driveId: ref.driveId, driveItemId: ref.driveItemId },
      { workspaceId: "default", actorUserId: "anonymous" },
    )
  })

  it("rejects invalid durable preview identifiers before provider calls", async () => {
    const provider = fakeProvider({ createOfficePreviewUrl: vi.fn() })
    const app = await testApp(provider)

    const invalidCases = [
      { driveId: " ", driveItemId: ref.driveItemId, error: SHAREPOINT_ERROR_CODES.INVALID_REF },
      { driveId: ref.driveId, driveItemId: `Bearer ${ref.driveItemId}`, error: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET },
      { driveId: `${ref.driveId}?access_token=secret`, driveItemId: ref.driveItemId, error: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET },
      { driveId: "x".repeat(513), driveItemId: ref.driveItemId, error: SHAREPOINT_ERROR_CODES.INVALID_REF },
    ]

    for (const payload of invalidCases) {
      const response = await app.inject({ method: "POST", url: SHAREPOINT_ROUTE_PATHS.preview, payload })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: payload.error })
      expect(response.body).not.toMatch(/access_token=secret|Bearer 01ROJO|xxxxx/)
    }
    expect(provider.createOfficePreviewUrl).not.toHaveBeenCalled()
  })

  it("rejects non-HTTPS preview results from the provider", async () => {
    const provider = fakeProvider({ createOfficePreviewUrl: vi.fn().mockResolvedValue({ getUrl: "http://tenant/preview?token=secret" }) })
    const app = await testApp(provider)

    const response = await app.inject({ method: "POST", url: SHAREPOINT_ROUTE_PATHS.preview, payload: { driveId: ref.driveId, driveItemId: ref.driveItemId } })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE, message: "SharePoint preview provider returned an invalid preview URL" })
    expect(response.body).not.toContain("http://tenant/preview")
  })

  it("rejects token-bearing preview ref input", async () => {
    const provider = fakeProvider({ createOfficePreviewUrl: vi.fn() })
    const app = await testApp(provider)

    const response = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.preview,
      payload: { ref: { ...ref, previewUrl: "https://tenant.sharepoint.com/preview?access_token=secret" } },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET })
    expect(provider.createOfficePreviewUrl).not.toHaveBeenCalled()
  })

  it("returns sanitized Office edit results from the edit route", async () => {
    const provider = fakeProvider({
      editOfficeDocument: vi.fn().mockResolvedValue({
        status: "succeeded",
        summary: "Added worksheet Forecast to tttt.xlsx",
        sessionId: "session-123",
        metadata: { raw: { previewUrl: "https://tenant/preview?access_token=secret" } },
      }),
    })
    const app = await testApp(provider)

    const response = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref, request: { kind: "excel.add-worksheet", worksheetName: "Forecast" } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: "succeeded", summary: "Added worksheet Forecast to tttt.xlsx", sessionId: "session-123" })
    expect(response.body).not.toMatch(/previewUrl|access_token|metadata|Bearer/i)
    expect(provider.editOfficeDocument).toHaveBeenCalledWith(ref, { kind: "excel.add-worksheet", worksheetName: "Forecast" }, { workspaceId: "default", actorUserId: "anonymous" })
  })

  it("accepts PowerPoint edit requests through the edit route", async () => {
    const provider = fakeProvider({ editOfficeDocument: vi.fn().mockResolvedValue({ status: "succeeded", summary: "Created PowerPoint slide in tttt.pptx" }) })
    const app = await testApp(provider)

    const response = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref: pptxRef, request: { kind: "powerpoint.create-slide", title: "Q3 update", body: "Revenue improved.", layout: "TITLE_AND_CONTENT" } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: "succeeded", summary: "Created PowerPoint slide in tttt.pptx" })
    expect(provider.editOfficeDocument).toHaveBeenCalledWith(
      pptxRef,
      { kind: "powerpoint.create-slide", title: "Q3 update", body: "Revenue improved.", layout: "TITLE_AND_CONTENT" },
      { workspaceId: "default", actorUserId: "anonymous" },
    )
  })

  it("rejects mismatched or invalid edit route input before provider calls", async () => {
    const provider = fakeProvider({ editOfficeDocument: vi.fn() })
    const app = await testApp(provider)

    const mismatch = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref, request: { kind: "powerpoint.create-slide", title: "Wrong file" } },
    })
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.json()).toMatchObject({ error: SHAREPOINT_ERROR_CODES.EDIT_CONFLICT })

    const invalid = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref, request: { kind: "excel.add-worksheet", worksheetName: "Bearer secret-token" } },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ error: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET })
    expect(invalid.body).not.toMatch(/secret-token|Bearer/i)
    expect(provider.editOfficeDocument).not.toHaveBeenCalled()
  })

  it("allow-lists failed and conflict edit route results", async () => {
    const app = await testApp(
      fakeProvider({
        editOfficeDocument: vi.fn().mockResolvedValueOnce({
          status: "failed",
          code: SHAREPOINT_ERROR_CODES.PROVIDER_TOOL_FAILED,
          message: "backend failed with previewUrl https://tenant/preview?access_token=secret",
          metadata: { raw: "secret" },
          getUrl: "https://tenant/preview?access_token=secret",
          authorizationUrl: "https://arcade.dev/auth?token=secret",
        } as never),
      }),
    )

    const failed = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref, request: { kind: "excel.add-worksheet", worksheetName: "Forecast" } },
    })

    expect(failed.statusCode).toBe(200)
    expect(failed.json()).toEqual({ status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_TOOL_FAILED, message: "SharePoint Office edit failed" })
    expect(failed.body).not.toMatch(/metadata|getUrl|authorizationUrl|access_token|previewUrl|secret/i)

    const conflictProvider = fakeProvider({
      editOfficeDocument: vi.fn().mockResolvedValue({
        status: "conflict",
        code: SHAREPOINT_ERROR_CODES.EDIT_CONFLICT,
        message: "edit conflict",
        previewUrl: "https://tenant/preview?access_token=secret",
      } as never),
    })
    const conflictApp = await testApp(conflictProvider)
    const conflict = await conflictApp.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref, request: { kind: "excel.add-worksheet", worksheetName: "Forecast" } },
    })

    expect(conflict.json()).toEqual({ status: "conflict", code: SHAREPOINT_ERROR_CODES.EDIT_CONFLICT, message: "edit conflict" })
    expect(conflict.body).not.toMatch(/previewUrl|access_token/)
  })

  it("imports local Office files and returns canonical ref metadata only", async () => {
    const importedExcelRef = { ...ref, createdFrom: { type: "local-import" as const, originalPath: "reports/forecast.xlsx" } }
    const importedPptxRef = { ...pptxRef, createdFrom: { type: "local-import" as const, originalPath: "decks/roadmap.pptx" } }
    const provider = fakeProvider({
      importLocalOfficeDocument: vi
        .fn()
        .mockResolvedValueOnce({
          ref: importedExcelRef,
          cloudRefPath: "reports/forecast.xlsx.cloud.json",
          previewUrl: "https://tenant/preview?access_token=secret",
        } as never)
        .mockResolvedValueOnce({ ref: importedPptxRef, cloudRefPath: "decks/roadmap.pptx.cloud.json" }),
    })
    const app = await testApp(provider)

    const excelResponse = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.import,
      payload: { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId, folderDriveItemId: "folder-1" } },
    })
    const pptxResponse = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.import,
      payload: { sourcePath: "decks/roadmap.pptx", contentHandle: "staged-upload-2", target: { folderWebUrl: "https://tenant.sharepoint.com/sites/team/docs" } },
    })

    expect(excelResponse.statusCode).toBe(200)
    expect(excelResponse.json()).toEqual({ ref: importedExcelRef, cloudRefPath: "reports/forecast.xlsx.cloud.json" })
    expect(excelResponse.body).not.toMatch(/previewUrl|getUrl|access_token|Bearer|\/home\/|\/tmp\//i)
    expect(pptxResponse.statusCode).toBe(200)
    expect(pptxResponse.json()).toEqual({ ref: importedPptxRef, cloudRefPath: "decks/roadmap.pptx.cloud.json" })
    expect(provider.importLocalOfficeDocument).toHaveBeenNthCalledWith(
      1,
      { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId, folderDriveItemId: "folder-1", folderWebUrl: undefined, siteUrl: undefined } },
      { workspaceId: "default", actorUserId: "anonymous" },
    )
  })

  it("rejects unsafe import route inputs before provider calls", async () => {
    const provider = fakeProvider({ importLocalOfficeDocument: vi.fn() })
    const app = await testApp(provider)

    const invalidPayloads = [
      { sourcePath: "/home/user/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId } },
      { sourcePath: "reports/../forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId } },
      { sourcePath: "reports/notes.docx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId } },
      { sourcePath: "reports/token-secret.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId } },
      { sourcePath: "reports/forecast.xlsx", contentHandle: "Bearer secret-token", target: { driveId: ref.driveId } },
      { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: `${ref.driveId}?access_token=secret` } },
      { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { folderWebUrl: "http://tenant.sharepoint.com/sites/team/docs" } },
    ]

    for (const payload of invalidPayloads) {
      const response = await app.inject({ method: "POST", url: SHAREPOINT_ROUTE_PATHS.import, payload })
      expect(response.statusCode).toBe(400)
      expect(response.body).not.toMatch(/secret-token|access_token=secret|Bearer|\/home\/user/)
    }
    expect(provider.importLocalOfficeDocument).not.toHaveBeenCalled()
  })

  it("rejects unsafe import provider results", async () => {
    const provider = fakeProvider({
      importLocalOfficeDocument: vi
        .fn()
        .mockResolvedValueOnce({
          ref: { ...ref, previewUrl: "https://tenant/preview?access_token=secret" },
          cloudRefPath: "/tmp/forecast.xlsx.cloud.json",
        })
        .mockResolvedValueOnce({
          ref: { ...ref, createdFrom: { type: "local-import", originalPath: "reports/forecast.xlsx" } },
          cloudRefPath: "C:\\tmp\\forecast.xlsx.cloud.json",
        }),
    })
    const app = await testApp(provider)

    const response = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.import,
      payload: { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId } },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET })
    expect(response.body).not.toMatch(/preview|access_token|\/tmp/)

    const windowsPathResponse = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.import,
      payload: { sourcePath: "reports/forecast.xlsx", contentHandle: "staged-upload-1", target: { driveId: ref.driveId } },
    })

    expect(windowsPathResponse.statusCode).toBe(502)
    expect(windowsPathResponse.json()).toEqual({ error: SHAREPOINT_ERROR_CODES.INVALID_REF, message: "import returned an unsafe cloud ref path" })
    expect(windowsPathResponse.body).not.toMatch(/C:\\tmp|forecast\.xlsx\.cloud\.json/)
  })

  it("rejects token-bearing edit refs before provider calls", async () => {
    const provider = fakeProvider({ editOfficeDocument: vi.fn() })
    const app = await testApp(provider)

    const response = await app.inject({
      method: "POST",
      url: SHAREPOINT_ROUTE_PATHS.edit,
      payload: { ref: { ...ref, previewUrl: "https://tenant/preview?access_token=secret" }, request: { kind: "excel.add-worksheet", worksheetName: "Forecast" } },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET })
    expect(response.body).not.toMatch(/access_token=secret|previewUrl/)
    expect(provider.editOfficeDocument).not.toHaveBeenCalled()
  })

  it("rejects route errors with stable JSON", async () => {
    const provider = fakeProvider({
      resolveDriveItem: vi.fn().mockRejectedValue(new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "unsupported file type")),
    })
    const app = await testApp(provider)

    const response = await app.inject({ method: "POST", url: SHAREPOINT_ROUTE_PATHS.resolve, payload: { webUrl: "https://tenant/file.docx" } })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: SHAREPOINT_ERROR_CODES.INVALID_REF, message: "unsupported file type" })
  })
})

async function testApp(provider: SharePointProvider) {
  const app = Fastify()
  apps.push(app)
  await app.register(sharePointRoutes, { provider })
  await app.ready()
  return app
}

function fakeProvider(overrides: Partial<SharePointProvider>): SharePointProvider {
  return {
    getStatus: vi.fn().mockResolvedValue({ status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message: "not configured" }),
    authorize: vi.fn(),
    resolveDriveItem: vi.fn(),
    createOfficePreviewUrl: vi.fn(),
    editOfficeDocument: vi.fn(),
    importLocalOfficeDocument: vi.fn(),
    ...overrides,
  }
}
