import { describe, expect, test } from "vitest"

import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  USER_FILESYSTEM_ID,
  normalizeUiFileResource,
  normalizeUiFilesystem,
  uiFileResourceKey,
  withUiFileResource,
} from "../types/filesystem"

describe("UI filesystem identity primitives", () => {
  test("legacy path-only resources bind to user filesystem", () => {
    expect(normalizeUiFilesystem(undefined)).toBe(USER_FILESYSTEM_ID)
    expect(normalizeUiFileResource("/src/app.ts")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/src/app.ts",
    })
    expect(normalizeUiFileResource({ path: "/src/app.ts" })).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/src/app.ts",
    })
  })

  test("company resources require explicit filesystem field", () => {
    expect(normalizeUiFileResource({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" }))
      .toEqual({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" })
    expect(normalizeUiFileResource("/company/hr/policy.md")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/company/hr/policy.md",
    })
  })

  test("path prefix strings do not switch filesystem identity", () => {
    expect(normalizeUiFileResource("company_context:/company/hr/policy.md")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "company_context:/company/hr/policy.md",
    })
    expect(normalizeUiFileResource("/company_context/company/hr/policy.md")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/company_context/company/hr/policy.md",
    })
  })

  test("resource keys separate identical paths across filesystems", () => {
    expect(uiFileResourceKey({ filesystem: USER_FILESYSTEM_ID, path: "/same.md" }))
      .toBe("user:/same.md")
    expect(uiFileResourceKey({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/same.md" }))
      .toBe("company_context:/same.md")
  })

  test("withUiFileResource preserves payload while filling legacy user default", () => {
    expect(withUiFileResource({ path: "/a.ts", mode: "edit" })).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/a.ts",
      mode: "edit",
    })
    expect(withUiFileResource({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/a.ts" })).toEqual({
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      path: "/a.ts",
    })
  })
})
