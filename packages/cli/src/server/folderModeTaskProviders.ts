import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type FolderModeTaskProvider =
  | { provider: "github"; repo: "auto" }
  | { provider: "beads" }

function isGitHubRemoteUrl(value: string): boolean {
  return /^(?:(?:https?|git|ssh):\/\/(?:[^@/\s]+@)?github\.com[/:]|(?:[^@/\s]+@)?github\.com:)/i.test(value.trim())
}

async function hasGitHubRemote(workspaceRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      workspaceRoot,
      "config",
      "--get-regexp",
      "^remote\\..*\\.url$",
    ], { timeout: 2_000, maxBuffer: 64 * 1024 })
    return stdout.split(/\r?\n/).some((line) => {
      const separator = line.search(/\s/)
      return separator >= 0 && isGitHubRemoteUrl(line.slice(separator + 1))
    })
  } catch {
    return false
  }
}

export async function detectFolderModeTaskProviders(workspaceRoot: string): Promise<FolderModeTaskProvider[]> {
  const providers: FolderModeTaskProvider[] = []
  if (await hasGitHubRemote(workspaceRoot)) providers.push({ provider: "github", repo: "auto" })
  if (existsSync(join(workspaceRoot, ".beads", "beads.db"))) providers.push({ provider: "beads" })
  return providers
}
