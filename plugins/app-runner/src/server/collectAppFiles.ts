import {
  APP_RUNNER_MAX_FILES,
  APP_RUNNER_MAX_FILE_BYTES,
  APP_RUNNER_MAX_TOTAL_BYTES,
} from "../shared/constants"
import { resolvePublishedFolder, runPublishGit } from "./commitPublishedFolder"

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
  /** Relative path (e.g. `app/index.js`) -> contents from the reported commit. */
  files: Record<string, string>
  totalBytes: number
}

/**
 * Reads the exact committed payload. Publishing never reads post-commit edits,
 * ignored files, Git metadata, or dotfiles (including `.env*`).
 */
export async function collectAppFiles(workspaceRoot: string, dir: string, sha: string): Promise<CollectAppFilesResult> {
  const folder = await resolvePublishedFolder(workspaceRoot, dir)
  const names = (await runPublishGit(folder, ["ls-tree", "-r", "--name-only", "-z", sha]))
    .split("\0")
    .filter((path) => path && !path.split("/").some((segment) => segment.startsWith(".")))

  if (names.length > APP_RUNNER_MAX_FILES) {
    throw new AppRunnerLimitError(
      "TOO_MANY_FILES",
      `app "${dir}" has more than ${APP_RUNNER_MAX_FILES} files; the app runner allows at most ${APP_RUNNER_MAX_FILES}.`,
    )
  }

  const files: Record<string, string> = {}
  let totalBytes = 0
  for (const path of names) {
    const size = Number(await runPublishGit(folder, ["cat-file", "-s", `${sha}:${path}`]))
    if (size > APP_RUNNER_MAX_FILE_BYTES) {
      throw new AppRunnerLimitError(
        "FILE_TOO_LARGE",
        `"${path}" is ${size} bytes, over the ${APP_RUNNER_MAX_FILE_BYTES} byte (2 MiB) per-file limit.`,
      )
    }
    totalBytes += size
    if (totalBytes > APP_RUNNER_MAX_TOTAL_BYTES) {
      throw new AppRunnerLimitError(
        "TOTAL_TOO_LARGE",
        `app "${dir}" is over the ${APP_RUNNER_MAX_TOTAL_BYTES} byte (10 MiB) total size limit.`,
      )
    }
    files[`app/${path}`] = await runPublishGit(folder, ["show", `${sha}:${path}`], false)
  }
  return { files, totalBytes }
}
