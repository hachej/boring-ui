import { access, lstat, realpath, readdir } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SAFE_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
}
const SAFE_GIT_CONFIG = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "credential.helper=",
  "-c", "commit.gpgSign=false",
]

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...SAFE_GIT_CONFIG, ...args], {
    cwd,
    encoding: "utf8",
    env: SAFE_GIT_ENV,
  })
  return stdout.trim()
}

export async function resolvePublishedFolder(workspaceRoot: string, dir: string): Promise<string> {
  if (!dir.trim() || isAbsolute(dir) || dir.split(/[\\/]+/).includes("..")) {
    throw new Error("publish directory must be a workspace-relative path without '..'")
  }
  const root = await realpath(workspaceRoot)
  const folder = await realpath(resolve(root, dir))
  const fromRoot = relative(root, folder)
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error("publish directory must be a folder inside the workspace root")
  }
  return folder
}

async function rejectNestedRepositories(folder: string, current = folder): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".git") {
      if (current !== folder) throw new Error("publish directory must not contain a nested Git repository")
      continue
    }
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await rejectNestedRepositories(folder, resolve(current, entry.name))
  }
}

async function verifyRepository(folder: string): Promise<void> {
  const topLevel = await realpath(await git(folder, ["rev-parse", "--show-toplevel"]))
  if (topLevel !== folder) throw new Error("publish repository worktree must be exactly the app folder")
  const gitPath = resolve(folder, ".git")
  const gitStats = await lstat(gitPath)
  if (gitStats.isSymbolicLink()) throw new Error("publish repository .git directory must not be a symlink")
  const gitDir = await realpath(await git(folder, ["rev-parse", "--absolute-git-dir"]))
  if (gitDir !== await realpath(gitPath)) throw new Error("publish repository metadata must be inside the app folder")

  const unsafe = await git(folder, [
    "config", "--local", "--name-only", "--get-regexp",
    "^(filter\\.|core\\.(hooksPath|fsmonitor)|credential\\.|include\\.)",
  ]).catch((error: unknown) => {
    const code = (error as { code?: number }).code
    if (code === 1) return ""
    throw error
  })
  if (unsafe) throw new Error(`publish repository contains unsafe Git configuration: ${unsafe.split("\n")[0]}`)
}

export async function commitPublishedFolder(workspaceRoot: string, dir: string, message: string): Promise<string> {
  const folder = await resolvePublishedFolder(workspaceRoot, dir)
  await rejectNestedRepositories(folder)
  try {
    await access(resolve(folder, ".git"))
  } catch {
    await git(folder, ["init"])
  }
  await verifyRepository(folder)
  await git(folder, ["add", "-A"])
  await git(folder, [
    "-c", "user.name=Boring App Publisher",
    "-c", "user.email=app-publisher@localhost",
    "commit", "--allow-empty", "-m", message,
  ])
  return git(folder, ["rev-parse", "HEAD"])
}
