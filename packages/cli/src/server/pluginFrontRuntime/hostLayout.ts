import { existsSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { realpathIfExists } from "./runtimePaths.js"

/**
 * Where the host itself lives on disk.
 *
 * The runtime host has to know its own package root and (in a monorepo
 * checkout) the repo root, because Vite runs rooted there and host-provided
 * packages are aliased to the host's copy so plugins share one instance.
 */

export interface RuntimeSingletonResolve {
  alias: Array<{ find: RegExp; replacement: string }>
  dedupe: string[]
}

export interface RuntimeHostLayout {
  repoRoot: string
  /** node_modules directories owned by the host; only these may be proxied via /@fs. */
  hostNodeModulesRoots: string[]
  /** Package roots trusted enough to be allowed host /@fs references at all. */
  trustedHostPackageRoots: string[]
  singletonResolve: RuntimeSingletonResolve
}

// This module sits at <package>/src/server/pluginFrontRuntime/ in source and
// at <package>/dist/server/pluginFrontRuntime/ in the published build, so the
// package root is three levels up in both layouts.
function packageRootFromRuntimeFile(): string {
  return resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
}

function findWorkspaceRoot(from: string): string {
  let current = from
  while (true) {
    if (existsSync(resolvePath(current, "pnpm-workspace.yaml"))) return current
    const parent = dirname(current)
    if (parent === current) return from
    current = parent
  }
}

/**
 * Aliases host-provided packages to the host's own build (falling back to
 * source in a dev checkout) and dedupes React so a plugin never instantiates
 * a second copy.
 */
function createRuntimeSingletonResolve(repoRoot: string): RuntimeSingletonResolve {
  const alias: Array<{ find: RegExp; replacement: string }> = []
  const localWorkspaceAliases = [
    ["@hachej/boring-workspace/plugin", resolvePath(repoRoot, "packages", "workspace", "dist", "plugin.js"), resolvePath(repoRoot, "packages", "workspace", "src", "plugin.ts")],
    ["@hachej/boring-workspace/events", resolvePath(repoRoot, "packages", "workspace", "dist", "events.js"), resolvePath(repoRoot, "packages", "workspace", "src", "front", "events", "index.ts")],
    ["@hachej/boring-workspace", resolvePath(repoRoot, "packages", "workspace", "dist", "workspace.js"), resolvePath(repoRoot, "packages", "workspace", "src", "index.ts")],
    ["@hachej/boring-ui-kit", resolvePath(repoRoot, "packages", "ui", "dist", "index.js"), resolvePath(repoRoot, "packages", "ui", "src", "index.ts")],
  ] as const
  for (const [specifier, builtReplacement, sourceReplacement] of localWorkspaceAliases) {
    const replacement = existsSync(builtReplacement) ? builtReplacement : sourceReplacement
    if (existsSync(replacement)) alias.push({ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), replacement })
  }
  return {
    alias,
    dedupe: ["react", "react-dom", "@hachej/boring-ui-kit"],
  }
}

export function resolveRuntimeHostLayout(): RuntimeHostLayout {
  const packageRoot = packageRootFromRuntimeFile()
  const repoRoot = findWorkspaceRoot(packageRoot)
  const hostNodeModulesRoots = [resolvePath(repoRoot, "node_modules"), resolvePath(packageRoot, "node_modules")]
    .filter((path, index, all) => existsSync(path) && all.indexOf(path) === index)
    .map((path) => realpathIfExists(path))
  const trustedHostPackageRoots = [realpathIfExists(repoRoot), ...hostNodeModulesRoots.map((path) => dirname(path))]
    .filter((path, index, all) => all.indexOf(path) === index)
  return {
    repoRoot,
    hostNodeModulesRoots,
    trustedHostPackageRoots,
    singletonResolve: createRuntimeSingletonResolve(repoRoot),
  }
}
