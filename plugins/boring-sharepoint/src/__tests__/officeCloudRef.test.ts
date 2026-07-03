import { describe, expect, it } from "vitest"
import {
  EXCEL_MIME_TYPE,
  POWERPOINT_MIME_TYPE,
  SHAREPOINT_ERROR_CODES,
  SharePointRefValidationError,
  assertSharePointDocumentRefSafeForStorage,
  officeKindForCloudRefPath,
  parseSharePointDocumentRef,
  parseSharePointDocumentRefJson,
  validateSharePointDocumentRef,
  type SharePointDocumentRef,
} from "../shared"

const validExcelRef: SharePointDocumentRef = {
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
  createdFrom: {
    type: "local-import",
    originalPath: "reports/forecast.xlsx",
  },
}

const validPowerPointRef: SharePointDocumentRef = {
  kind: "office-cloud-document",
  provider: "sharepoint",
  version: 1,
  name: "deck.pptx",
  officeKind: "powerpoint",
  mimeType: POWERPOINT_MIME_TYPE,
  webUrl: "https://tenant.sharepoint.com/sites/team/Shared%20Documents/deck.pptx",
  siteId: "tenant.sharepoint.com,site-id,web-id",
  driveId: "drive-id",
  driveItemId: "deck-id",
}

describe("SharePoint Office cloud refs", () => {
  it("accepts valid Excel and PowerPoint refs", () => {
    expect(validateSharePointDocumentRef(validExcelRef)).toEqual({ ok: true, errors: [] })
    expect(validateSharePointDocumentRef(validPowerPointRef)).toEqual({ ok: true, errors: [] })
    expect(parseSharePointDocumentRef(validExcelRef)).toEqual(validExcelRef)
    expect(parseSharePointDocumentRefJson(JSON.stringify(validPowerPointRef))).toEqual(validPowerPointRef)
  })

  it("resolves office kind from cloud-ref path suffix", () => {
    expect(officeKindForCloudRefPath("forecast.xlsx.cloud.json")).toBe("excel")
    expect(officeKindForCloudRefPath("deck.pptx.cloud.json")).toBe("powerpoint")
    expect(officeKindForCloudRefPath("notes.md")).toBeNull()
  })

  it("rejects missing identity and mismatched Office metadata", () => {
    const result = validateSharePointDocumentRef({
      ...validExcelRef,
      driveItemId: "",
      officeKind: "powerpoint",
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain("driveItemId must be a non-empty string")
    expect(result.errors).toContain("mimeType must match officeKind powerpoint")
    expect(result.errors).toContain("powerpoint refs must use a .pptx name")
  })

  it("rejects token-bearing fields and URLs", () => {
    const refWithToken = {
      ...validExcelRef,
      accessToken: "secret-token",
      previewUrl: "https://tenant.sharepoint.com/embed.aspx?access_token=secret",
    }

    expect(validateSharePointDocumentRef(refWithToken).ok).toBe(false)
    expect(() => parseSharePointDocumentRef(refWithToken)).toThrow(SharePointRefValidationError)
    try {
      parseSharePointDocumentRef(refWithToken)
    } catch (error) {
      expect(error).toBeInstanceOf(SharePointRefValidationError)
      expect((error as SharePointRefValidationError).code).toBe(SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET)
    }
  })

  it("rejects absolute local paths in createdFrom", () => {
    const result = validateSharePointDocumentRef({
      ...validExcelRef,
      createdFrom: {
        type: "local-import",
        originalPath: "/home/user/forecast.xlsx",
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain("createdFrom.originalPath must be workspace-relative, not absolute")
  })

  it("asserts stored refs contain no secret-like keys or token-bearing strings", () => {
    expect(() => assertSharePointDocumentRefSafeForStorage(validExcelRef)).not.toThrow()
    expect(() =>
      assertSharePointDocumentRefSafeForStorage({
        ...validPowerPointRef,
        nested: { wopiToken: "secret" },
      }),
    ).toThrow(SharePointRefValidationError)
  })
})
