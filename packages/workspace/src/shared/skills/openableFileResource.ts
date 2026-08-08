import { isSafePluginRelativePath } from "../plugins/manifest"
import type { UiFileResource } from "../types/filesystem"

/**
 * Security-relevant validation for a skill resource path arriving from the
 * server before it is handed to the `openFile` UI command. Rejects anything
 * that is not a plain, contained, relative path: percent-encoded traversal,
 * scheme-prefixed values (`file:`, `javascript:`, …), empty or `.` segments.
 *
 * Every surface that opens a skill file MUST go through here — a forked copy
 * is how one caller silently drifts into accepting what the other rejects.
 */
export function isSafeRelativeSkillPath(value: unknown): value is string {
  return typeof value === "string"
    && isSafePluginRelativePath(value)
    && !/%(?:2e|2f|5c)/i.test(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.split("/").some((segment) => segment === "" || segment === ".")
}

/** The skill's file resource when it is safe to open, else `undefined`. */
export function openableSkillResource(
  skill: { resource?: UiFileResource },
): UiFileResource | undefined {
  const resource = skill.resource
  return resource
    && typeof resource.filesystem === "string"
    && resource.filesystem.length > 0
    && isSafeRelativeSkillPath(resource.path)
    ? resource
    : undefined
}
