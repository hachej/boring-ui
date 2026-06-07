import { join, resolve } from "node:path"

import { createPlugin } from "./createPlugin"
import { scaffoldPlugin } from "./scaffoldPlugin"
import {
  findHintForError,
  formatVerifyResult,
  verifyPlugin,
} from "./verifyPlugin"
export {
  formatPluginSourceList,
  installPluginSource,
  listPluginSources,
  readPluginSourceRecords,
  readPluginSourceRecordsForRoots,
  removePluginSource,
  resolvePluginSourceScopePaths,
} from "./pluginSources"
export type {
  InstallPluginSourceOptions,
  ListPluginSourcesOptions,
  PluginInstallResult,
  PluginInstallScope,
  PluginListResult,
  PluginRemoveResult,
  PluginSourceKind,
  PluginSourceRecord,
  PluginSourceScopePaths,
  RemovePluginSourceOptions,
} from "./pluginSources"

function defaultWorkspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
}

export function workspaceLocalPluginRootsEnabled(): boolean {
  const raw = process.env.BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS
  if (raw == null || raw.trim() === "") return true
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase())
}

export interface PluginStatus {
  workspaceLocalPluginRoots: boolean
  workspaceRoot: string
  extensionsDir: string
  reloadSupported: boolean
  reason?: string
}

export function buildPluginStatus(workspaceRoot = defaultWorkspaceRoot()): PluginStatus {
  const resolvedRoot = resolve(workspaceRoot)
  const enabled = workspaceLocalPluginRootsEnabled()
  return {
    workspaceLocalPluginRoots: enabled,
    workspaceRoot: resolvedRoot,
    extensionsDir: join(resolvedRoot, ".pi", "extensions"),
    reloadSupported: enabled,
    ...(enabled ? {} : {
      reason: "This runtime writes to a remote sandbox; host-side plugin discovery cannot load .pi/extensions from there.",
    }),
  }
}

export function parseVerifyArgs(positionals: string[], workspaceRoot = defaultWorkspaceRoot()): { name?: string; workspaceRoot: string } {
  const maybeName = positionals[0]
  const maybeWorkspace = positionals[1]
  const looksLikePath = maybeName && (maybeName.includes("/") || maybeName.startsWith("."))
  const name = looksLikePath ? undefined : maybeName
  return {
    ...(name ? { name } : {}),
    workspaceRoot: resolve(maybeWorkspace ?? (looksLikePath ? maybeName! : workspaceRoot)),
  }
}

export function parseScaffoldArgs(positionals: string[], workspaceRoot = defaultWorkspaceRoot()): { name: string; workspaceRoot: string } {
  const name = positionals[0]
  if (!name) throw new Error("usage: boring-ui-plugin scaffold <name> [workspace]")
  return { name, workspaceRoot: resolve(positionals[1] ?? workspaceRoot) }
}

export function parseCreateArgs(positionals: string[]): { name: string } {
  const name = positionals[0]
  if (!name) throw new Error("usage: boring-ui-plugin create <name> [--path <dir>]")
  return { name }
}

export {
  createPlugin,
  scaffoldPlugin,
  verifyPlugin,
  formatVerifyResult,
  findHintForError,
}
export type {
  CreatePluginOptions,
  CreatePluginResult,
} from "./createPlugin"
export type {
  ScaffoldPluginOptions,
  ScaffoldPluginResult,
} from "./scaffoldPlugin"
export type {
  PluginVerifyOutcome,
  VerifyPluginResult,
} from "./verifyPlugin"
