import { describe, expect, test } from "vitest"

import {
  USER_FILESYSTEM_ID,
  normalizeUiFileResource,
  normalizeUiFilesystem,
  uiFileResourceKey,
  withUiFileResource,
} from "../types/filesystem"

const EXTERNAL_FILESYSTEM_ID = "external"

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

  test("external resources require explicit filesystem field", () => {
    expect(normalizeUiFileResource({ filesystem: EXTERNAL_FILESYSTEM_ID, path: "/docs/policy.md" }))
      .toEqual({ filesystem: EXTERNAL_FILESYSTEM_ID, path: "/docs/policy.md" })
    expect(normalizeUiFileResource("/docs/policy.md")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/docs/policy.md",
    })
  })

  test("path prefix strings do not switch filesystem identity", () => {
    expect(normalizeUiFileResource("external:/docs/policy.md")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "external:/docs/policy.md",
    })
    expect(normalizeUiFileResource("/external/docs/policy.md")).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/external/docs/policy.md",
    })
  })

  test("resource keys separate identical paths across filesystems", () => {
    expect(uiFileResourceKey({ filesystem: USER_FILESYSTEM_ID, path: "/same.md" }))
      .toBe("user:/same.md")
    expect(uiFileResourceKey({ filesystem: EXTERNAL_FILESYSTEM_ID, path: "/same.md" }))
      .toBe("external:/same.md")
    expect(uiFileResourceKey({ filesystem: "a:b", path: "c" }))
      .not.toBe(uiFileResourceKey({ filesystem: "a", path: "b:c" }))
  })

  test("withUiFileResource preserves payload while filling legacy user default", () => {
    expect(withUiFileResource({ path: "/a.ts", mode: "edit" })).toEqual({
      filesystem: USER_FILESYSTEM_ID,
      path: "/a.ts",
      mode: "edit",
    })
    expect(withUiFileResource({ filesystem: EXTERNAL_FILESYSTEM_ID, path: "/a.ts" })).toEqual({
      filesystem: EXTERNAL_FILESYSTEM_ID,
      path: "/a.ts",
    })
  })
})
