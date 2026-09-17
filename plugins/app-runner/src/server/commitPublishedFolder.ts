import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" })
  return stdout.trim()
}

export async function commitPublishedFolder(workspaceRoot: string, dir: string, message: string): Promise<string> {
  const folder = resolve(workspaceRoot, dir)
  try {
    await access(resolve(folder, ".git"))
  } catch {
    await git(folder, ["init"])
    await git(folder, ["config", "user.name", "Boring App Publisher"])
    await git(folder, ["config", "user.email", "app-publisher@localhost"])
  }
  await git(folder, ["add", "-A"])
  await git(folder, ["commit", "--allow-empty", "-m", message])
  return git(folder, ["rev-parse", "HEAD"])
}
