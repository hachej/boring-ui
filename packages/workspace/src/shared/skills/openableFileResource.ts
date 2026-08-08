import { isSafePluginRelativePath } from "../plugins/manifest"
import type { UiFileResource } from "../types/filesystem"

/**
 * Security-relevant validation for a file path arriving from the server before
 * it is handed to the `openFile` UI command. Rejects anything that is not a
 * plain, contained, relative path: percent-encoded traversal, scheme-prefixed
 * values (`file:`, `javascript:`, …), empty or `.` segments.
 *
 * Deliberately module-private: callers get the whole decision through
 * `openableFileResource`, so no surface can validate the path but forget the
 * filesystem id (or vice versa).
 */
function isSafeRelativeFilePath(value: unknown): value is string {
  return typeof value === "string"
    && isSafePluginRelativePath(value)
    && !/%(?:2e|2f|5c)/i.test(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.split("/").some((segment) => segment === "" || segment === ".")
}

/**
 * The resource when it is safe to open, else `undefined`.
 *
 * EVERY surface that opens a server-supplied file MUST go through here —
 * skills, agent instruction files, anything else. A forked copy is how one
 * caller silently drifts into accepting what another rejects.
 */
export function openableFileResource(
  resource: { filesystem?: unknown; path?: unknown } | undefined | null,
): UiFileResource | undefined {
  return resource
    && typeof resource.filesystem === "string"
    && resource.filesystem.length > 0
    && isSafeRelativeFilePath(resource.path)
    ? { filesystem: resource.filesystem, path: resource.path }
    : undefined
}
