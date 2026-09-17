import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import {
  APP_RUNNER_MAX_FILES,
  APP_RUNNER_MAX_FILE_BYTES,
  APP_RUNNER_MAX_TOTAL_BYTES,
} from "../shared/constants"

export class AppRunnerLimitError extends Error {
  constructor(
    public readonly code: "TOO_MANY_FILES" | "FILE_TOO_LARGE" | "TOTAL_TOO_LARGE",
    message: string,
  ) {
    super(message)
    this.name = "AppRunnerLimitError"
  }
}

export interface CollectAppFilesResult {
  /** Relative path (e.g. `app/index.js`) -> file contents. */
  files: Record<string, string>
  totalBytes: number
}

/**
 * Recursively reads every file under `workspaceRoot/dir`, returning a
 * `{relativePath: contents}` map keyed by paths relative to `workspaceRoot`
 * (so `app/index.js`, matching the app runner's publish contract).
 *
 * Enforces the same limits as the runner's own 413 response
 * (200 files / 2 MiB per file / 10 MiB total) client-side, before any
 * network call, so the agent gets fast, specific feedback instead of a
 * generic HTTP error after uploading.
 */
export async function collectAppFiles(workspaceRoot: string, dir: string): Promise<CollectAppFilesResult> {
  const absoluteDir = resolve(workspaceRoot, dir)
  const files: Record<string, string> = {}
  let totalBytes = 0
  let fileCount = 0

  async function walk(currentDir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`app directory "${dir}" does not exist in the workspace`)
      }
      throw error
    }
    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      if (!entry.isFile()) continue

      fileCount += 1
      if (fileCount > APP_RUNNER_MAX_FILES) {
        throw new AppRunnerLimitError(
          "TOO_MANY_FILES",
          `app "${dir}" has more than ${APP_RUNNER_MAX_FILES} files; the app runner allows at most ${APP_RUNNER_MAX_FILES}.`,
        )
      }

      const stats = await stat(entryPath)
      if (stats.size > APP_RUNNER_MAX_FILE_BYTES) {
        const relativePath = relative(workspaceRoot, entryPath)
        throw new AppRunnerLimitError(
          "FILE_TOO_LARGE",
          `"${relativePath}" is ${stats.size} bytes, over the ${APP_RUNNER_MAX_FILE_BYTES} byte (2 MiB) per-file limit.`,
        )
      }

      totalBytes += stats.size
      if (totalBytes > APP_RUNNER_MAX_TOTAL_BYTES) {
        throw new AppRunnerLimitError(
          "TOTAL_TOO_LARGE",
          `app "${dir}" is over the ${APP_RUNNER_MAX_TOTAL_BYTES} byte (10 MiB) total size limit.`,
        )
      }

      const relativePath = relative(workspaceRoot, entryPath).split("\\").join("/")
      files[relativePath] = await readFile(entryPath, "utf8")
    }
  }

  await walk(absoluteDir)

  return { files, totalBytes }
}
