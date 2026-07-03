import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EXCEL_MIME_TYPE, SHAREPOINT_ERROR_CODES, type SharePointProvider } from "../shared"
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
    ...overrides,
  }
}
