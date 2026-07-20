#!/usr/bin/env node
/**
 * Audit the manifests that npm will actually receive.
 *
 * pnpm rewrites workspace:* ranges during packing. This script verifies the
 * packed package.json files, not the repo-local manifests, so release failures
 * catch the same metadata users/npm will see.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const PUBLISHABLE_PACKAGES = [
  "packages/ui",
  "packages/boring-bash",
  "packages/boring-sandbox",
  "packages/agent",
  "packages/plugin-cli",
  "packages/workspace",
  "packages/core",
  "plugins/deck",
  "plugins/ask-user",
  "plugins/diagram",
  "plugins/tasks",
  "plugins/boring-automation",
  "packages/cli",
  "plugins/data-explorer",
  "plugins/data-catalog",
  "plugins/generated-pane",
  "plugins/data-bridge",
  "plugins/bi-dashboard",
  "plugins/boring-mcp",
  "plugins/boring-governance",
]

const DEP_SECTIONS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
]

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function fail(message) {
  throw new Error(message)
}

function formatPackage(pkg) {
  return `${pkg.name}@${pkg.version}`
}

function assertRepository(pkg, packagePath) {
  const repository = pkg.repository
  const url = typeof repository === "string" ? repository : repository?.url
  if (!url) {
    fail(`${formatPackage(pkg)} (${packagePath}) must set repository.url for npm provenance`)
  }
  if (!url.includes("github.com/hachej/boring-ui")) {
    fail(`${formatPackage(pkg)} (${packagePath}) repository.url must point at hachej/boring-ui; got ${url}`)
  }
}

function npmHasVersion(name, range) {
  try {
    execFileSync("npm", ["view", `${name}@${range}`, "version", "--json"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    })
    return true
  } catch {
    return false
  }
}

function packManifest(packagePath, tempRoot) {
  const packageDir = resolve(root, packagePath)
  const packDir = join(tempRoot, packagePath.replaceAll("/", "__"))
  mkdirSync(packDir, { recursive: true })
  const output = execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: packageDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  })
  const lastLine = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!lastLine) fail(`pnpm pack produced no tarball path for ${packagePath}`)

  const tarball = isAbsolute(lastLine) ? lastLine : resolve(packDir, lastLine)
  if (!existsSync(tarball)) fail(`pnpm pack tarball not found for ${packagePath}: ${tarball}`)

  const extractDir = join(packDir, "extract")
  mkdirSync(extractDir, { recursive: true })
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir, "package/package.json"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return readJson(join(extractDir, "package/package.json"))
}

function collectDependencyEntries(pkg) {
  const entries = []
  for (const section of DEP_SECTIONS) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      entries.push({ section, name, spec: String(spec) })
    }
  }
  return entries
}

function main() {
  const sourcePackages = PUBLISHABLE_PACKAGES.map((packagePath, index) => {
    const pkg = readJson(resolve(root, packagePath, "package.json"))
    return { ...pkg, packagePath, index }
  })
  const releasePlan = new Map(sourcePackages.map((pkg) => [pkg.name, pkg]))

  const tempRoot = mkdtempSync(join(tmpdir(), "boring-publish-manifest-audit-"))
  const errors = []

  try {
    for (const sourcePkg of sourcePackages) {
      try {
        assertRepository(sourcePkg, sourcePkg.packagePath)
        const packedPkg = packManifest(sourcePkg.packagePath, tempRoot)
        assertRepository(packedPkg, sourcePkg.packagePath)

        for (const { section, name, spec } of collectDependencyEntries(packedPkg)) {
          if (spec.startsWith("workspace:")) {
            fail(`${formatPackage(packedPkg)} ${section}.${name} leaked ${spec} into packed manifest`)
          }
          if (name.startsWith("@hachej/") && /^(file|link|workspace):/.test(spec)) {
            fail(`${formatPackage(packedPkg)} ${section}.${name} uses non-registry spec ${spec}`)
          }
          if (!name.startsWith("@hachej/")) continue

          // peerDependencies and devDependencies are not installed by consumers
          // at publish time, so declaring a peer/dev range on a workspace package
          // that is not yet published (or is published later in the release order)
          // is valid. Only runtime dependencies/optionalDependencies must resolve
          // at install time, so only those gate publish order. This lets the
          // boring-agent <-> boring-sandbox / boring-bash cycles (agent depends on
          // them at runtime; they peer-depend back on agent for shared types)
          // publish sandbox/bash before agent without the peer-back-edges failing.
          if (section === "peerDependencies" || section === "devDependencies") continue

          if (npmHasVersion(name, spec)) continue

          const planned = releasePlan.get(name)
          const isEarlierInRelease = planned && planned.version === spec && planned.index < sourcePkg.index
          if (isEarlierInRelease) continue

          if (planned && planned.version === spec) {
            fail(
              `${formatPackage(packedPkg)} ${section}.${name}@${spec} is not published yet and appears later/same in release order`,
            )
          }
          fail(`${formatPackage(packedPkg)} ${section}.${name}@${spec} is not published on npm`)
        }

        console.log(`✓ ${formatPackage(packedPkg)} manifest ok`)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  if (errors.length > 0) {
    console.error("\nPublish manifest audit failed:")
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log("\nAll publish manifests are safe to publish.")
}

main()
