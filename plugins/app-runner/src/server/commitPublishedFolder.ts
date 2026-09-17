import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { lstat, mkdir, realpath, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SAFE_GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  LANG: "C",
  LC_ALL: "C",
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

export interface PublishGitContext {
  readonly cwd: string
  readonly gitDir: string
  readonly workTree: string
}

export async function runPublishGit(context: PublishGitContext, args: string[], trim = true): Promise<string> {
  const { stdout } = await execFileAsync("git", [
    ...SAFE_GIT_CONFIG,
    `--git-dir=${context.gitDir}`,
    `--work-tree=${context.workTree}`,
    ...args,
  ], {
    cwd: context.cwd,
    encoding: "utf8",
    env: SAFE_GIT_ENV,
    maxBuffer: 16 * 1024 * 1024,
  })
  return trim ? stdout.trim() : stdout
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

async function rejectAppRepositories(folder: string, current = folder): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".git") {
      throw new Error(current === folder
        ? "publish directory must not contain app-controlled Git metadata"
        : "publish directory must not contain a nested Git repository")
    }
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await rejectAppRepositories(folder, resolve(current, entry.name))
  }
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return !isAbsolute(fromParent) && fromParent !== ".." && !fromParent.startsWith(`..${sep}`)
}

export async function resolvePublishGitContext(
  workspaceRoot: string,
  dir: string,
  metadataRoot = process.env.BORING_APP_RUNNER_GIT_ROOT ?? join(tmpdir(), "boring-app-runner-git"),
): Promise<PublishGitContext> {
  const workspace = await realpath(workspaceRoot)
  const workTree = await resolvePublishedFolder(workspace, dir)
  await rejectAppRepositories(workTree)

  await mkdir(metadataRoot, { recursive: true, mode: 0o700 })
  const cwd = await realpath(metadataRoot)
  if (isInside(workspace, cwd) || isInside(cwd, workspace)) {
    throw new Error("publish Git metadata root must be outside the app-controlled workspace")
  }
  const key = createHash("sha256").update(`${workspace}\0${relative(workspace, workTree)}`).digest("hex")
  const gitDir = join(cwd, key)
  try {
    const stats = await lstat(gitDir)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("publish Git metadata must be a host-owned directory")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await execFileAsync("git", [...SAFE_GIT_CONFIG, "init", "--quiet", "--bare", gitDir], {
      cwd,
      encoding: "utf8",
      env: SAFE_GIT_ENV,
    })
  }
  const resolvedGitDir = await realpath(gitDir)
  if (!isInside(cwd, resolvedGitDir)) throw new Error("publish Git metadata escaped its host-owned root")
  return { cwd, gitDir: resolvedGitDir, workTree }
}

async function publishablePaths(context: PublishGitContext): Promise<string[]> {
  const output = await runPublishGit(context, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  return output.split("\0").filter((path) => path && !path.split("/").some((segment) => segment.startsWith(".")))
}

export async function commitPublishedFolder(workspaceRoot: string, dir: string, message: string): Promise<string> {
  const context = await resolvePublishGitContext(workspaceRoot, dir)
  const paths = await publishablePaths(context)
  await runPublishGit(context, ["rm", "-r", "--cached", "--ignore-unmatch", "."])
  for (let index = 0; index < paths.length; index += 100) {
    await runPublishGit(context, ["add", "--", ...paths.slice(index, index + 100)])
  }
  await runPublishGit(context, [
    "-c", "user.name=Boring App Publisher",
    "-c", "user.email=app-publisher@localhost",
    "commit", "--allow-empty", "-m", message,
  ])
  return runPublishGit(context, ["rev-parse", "HEAD"])
}
