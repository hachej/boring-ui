import { type ProvisionWorkspaceRuntimeOptions } from "@hachej/boring-agent/server"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { WorkspacePiPackageSource, WorkspaceProvisioningContribution } from "../../server/plugins/bootstrapServer"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

type WorkspaceRuntimeProvisioningInput = ProvisionWorkspaceRuntimeOptions["plugins"][number]

export function boringPiRootVisibleToAgentTools(workspaceRoot: string, resolvedMode: string, provisioned: boolean): string | undefined {
  void workspaceRoot
  void resolvedMode
  if (!provisioned) return undefined
  // Sandbox-rooted absolute path is unambiguous regardless of agent cwd
  // changes. Avoid host paths (they leak /home/... and are rejected by
  // the sandbox) and avoid bare relative paths (they break on `cd`).
  return "/workspace/.boring-agent/node/node_modules/@hachej/boring-pi"
}

function resolveWorkspacePackageRoot(): string {
  const candidates = [
    join(__dirname, ".."),
    join(__dirname, "../../.."),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
      if (pkg.name === "@hachej/boring-workspace") return candidate
    } catch {
      // try next layout
    }
  }
  return join(__dirname, "../../..")
}

function readPackageVersion(packageRoot: string | null): string | undefined {
  if (!packageRoot) return undefined
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown }
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined
  } catch {
    return undefined
  }
}

function useLocalPackageProvisioning(): boolean {
  return process.env.BORING_USE_LOCAL_PACKAGES === "1"
}

function resolveBoringPiPackageRoot(): string | null {
  const workspacePackageRoot = resolveWorkspacePackageRoot()
  const candidates = [
    join(workspacePackageRoot, "..", "pi"),
    join(workspacePackageRoot, "node_modules", "@hachej", "boring-pi"),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
      if (pkg.name === "@hachej/boring-pi") return candidate
    } catch {
      // try next layout
    }
  }
  try {
    return dirname(require.resolve("@hachej/boring-pi/package.json"))
  } catch {
    return null
  }
}

function isUsableBoringUiPluginCliPackageRoot(candidate: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
    return pkg.name === "@hachej/boring-ui-plugin-cli"
      && existsSync(join(candidate, "dist", "bin.js"))
  } catch {
    return false
  }
}

function resolveBoringUiPluginCliPackageRoot(): string | null {
  const workspacePackageRoot = resolveWorkspacePackageRoot()
  const candidates = [
    join(workspacePackageRoot, "..", "plugin-cli"),
    join(workspacePackageRoot, "node_modules", "@hachej", "boring-ui-plugin-cli"),
  ]
  for (const candidate of candidates) {
    if (isUsableBoringUiPluginCliPackageRoot(candidate)) return candidate
  }
  try {
    const resolved = dirname(require.resolve("@hachej/boring-ui-plugin-cli/package.json"))
    return isUsableBoringUiPluginCliPackageRoot(resolved) ? resolved : null
  } catch {
    return null
  }
}

export const PLUGIN_AUTHORING_PROVISIONING_IDS = new Set(["boring-ui-plugin-cli-package"])

export function omitPluginAuthoringProvisioning(
  plugins: WorkspaceRuntimeProvisioningInput[],
): WorkspaceRuntimeProvisioningInput[] {
  return plugins.filter((plugin) => !PLUGIN_AUTHORING_PROVISIONING_IDS.has(plugin.id))
}

export function createBoringUiPluginCliPackageProvisioningContribution(): WorkspaceProvisioningContribution | null {
  const packageRoot = useLocalPackageProvisioning() ? resolveBoringUiPluginCliPackageRoot() : null
  const version = readPackageVersion(resolveWorkspacePackageRoot())

  return {
    id: "boring-ui-plugin-cli-package",
    provisioning: {
      nodePackages: [{
        id: "boring-ui-plugin-cli",
        packageName: "@hachej/boring-ui-plugin-cli",
        ...(packageRoot ? { packageRoot } : { version }),
        expectedBins: ["boring-ui-plugin"],
      }],
    },
  }
}

export function createBoringPiPackageSource(workspaceRoot: string): WorkspacePiPackageSource | undefined {
  const workspacePackageRoot = join(workspaceRoot, "node_modules", "@hachej", "boring-pi")
  const source = existsSync(join(workspacePackageRoot, "package.json"))
    ? workspacePackageRoot
    : resolveBoringPiPackageRoot()
  if (!source || !existsSync(join(source, "package.json"))) return undefined
  return { source, skills: ["skills/boring-plugin-authoring"] }
}

/**
 * Direct absolute path(s) to bundled boring-pi skills.
 *
 * The boring-pi package source above is the canonical declarative way to
 * register the skill, but Pi's DefaultResourceLoader skips package-resolved
 * skills (`enabledSkills`) when `noSkills: true` is set — and boring's
 * canonical harness policy (`withPiHarnessDefaults` in @hachej/boring-agent)
 * defaults to `noSkills: true` so user-global skills (~/.agents/skills)
 * don't leak into hosted agents' prompts. To keep OUR
 * skill flowing regardless of that filter, we also push the SKILL.md
 * path into `additionalSkillPaths`, which Pi loads via its skillsOverride
 * even under noSkills. Belt-and-suspenders so the agent always sees the
 * plugin-authoring skill.
 */
export function resolveBoringPiSkillPaths(workspaceRoot: string): string[] {
  const pkg = createBoringPiPackageSource(workspaceRoot)
  const root = typeof pkg === "string" ? pkg : pkg?.source
  if (!root) return []
  const skillFile = join(root, "skills", "boring-plugin-authoring", "SKILL.md")
  return existsSync(skillFile) ? [skillFile] : []
}
