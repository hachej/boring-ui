import {
  APP_RUNNER_MAX_FILES,
  APP_RUNNER_MAX_FILE_BYTES,
  APP_RUNNER_MAX_TOTAL_BYTES,
} from "../shared/constants"
import { resolvePublishGitContext, runPublishGit, runPublishGitBuffer } from "./commitPublishedFolder"

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
  files: Record<string, string | { base64: string }>
  totalBytes: number
}

/**
 * Reads the exact committed payload. Publishing never reads post-commit edits,
 * ignored files, Git metadata, or dotfiles (including `.env*`).
 */
export async function collectAppFiles(workspaceRoot: string, dir: string, sha: string): Promise<CollectAppFilesResult> {
  const context = await resolvePublishGitContext(workspaceRoot, dir)
  const names = (await runPublishGit(context, ["ls-tree", "-r", "--name-only", "-z", sha]))
    .split("\0")
    .filter((path) => path && !path.split("/").some((segment) => segment.startsWith(".")))

  if (names.length > APP_RUNNER_MAX_FILES) {
    throw new AppRunnerLimitError(
      "TOO_MANY_FILES",
      `app "${dir}" has more than ${APP_RUNNER_MAX_FILES} files; the app runner allows at most ${APP_RUNNER_MAX_FILES}.`,
    )
  }

  const files: Record<string, string | { base64: string }> = {}
  let totalBytes = 0
  for (const path of names) {
    const size = Number(await runPublishGit(context, ["cat-file", "-s", `${sha}:${path}`]))
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
    const bytes = await runPublishGitBuffer(context, ["show", `${sha}:${path}`])
    const text = bytes.toString("utf8")
    files[`app/${path}`] = Buffer.from(text, "utf8").equals(bytes) ? text : { base64: bytes.toString("base64") }
  }
  return { files, totalBytes }
}
