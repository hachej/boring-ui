import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const BORING_AGENT_DIR = '.boring-agent'
export const BORING_AGENT_RUNTIME_DIR_NAMES = [
  'bin',
  'node',
  'venv',
  'sdk',
  'state',
  'cache',
  'tmp',
  'logs',
] as const

export type BoringAgentRuntimeDirName = (typeof BORING_AGENT_RUNTIME_DIR_NAMES)[number]

export const BORING_AGENT_OWNERSHIP_MARKER_FILENAME = '.boring-agent-owned.json'
export const BORING_AGENT_OWNER = '@hachej/boring-agent'
export const BORING_AGENT_OWNERSHIP_MARKER_VERSION = 1
export const BORING_AGENT_PROVISIONING_MARKER_REL_PATH = `${BORING_AGENT_DIR}/state/provisioning.json`
export const BORING_AGENT_OWNERSHIP_MANIFEST_REL_PATH = `${BORING_AGENT_DIR}/state/ownership.json`

export interface BoringAgentRuntimePaths {
  root: string
  bin: string
  node: string
  nodeModules: string
  venv: string
  venvBin: string
  venvPython: string
  sdk: string
  state: string
  cache: string
  tmp: string
  logs: string
  provisioningMarker: string
  ownershipManifest: string
}

export interface BoringAgentOwnershipMarker {
  v: typeof BORING_AGENT_OWNERSHIP_MARKER_VERSION
  owner: typeof BORING_AGENT_OWNER
  path: string
  kind: 'runtime-dir'
}

function markerFor(path: string, kind: BoringAgentOwnershipMarker['kind']): BoringAgentOwnershipMarker {
  return {
    v: BORING_AGENT_OWNERSHIP_MARKER_VERSION,
    owner: BORING_AGENT_OWNER,
    path,
    kind,
  }
}

export function getBoringAgentRuntimePaths(workspaceRoot: string): BoringAgentRuntimePaths {
  const root = join(workspaceRoot, BORING_AGENT_DIR)
  const node = join(root, 'node')
  const venv = join(root, 'venv')
  const state = join(root, 'state')

  return {
    root,
    bin: join(root, 'bin'),
    node,
    nodeModules: join(node, 'node_modules'),
    venv,
    venvBin: join(venv, 'bin'),
    venvPython: join(venv, 'bin', 'python'),
    sdk: join(root, 'sdk'),
    state,
    cache: join(root, 'cache'),
    tmp: join(root, 'tmp'),
    logs: join(root, 'logs'),
    provisioningMarker: join(workspaceRoot, BORING_AGENT_PROVISIONING_MARKER_REL_PATH),
    ownershipManifest: join(workspaceRoot, BORING_AGENT_OWNERSHIP_MANIFEST_REL_PATH),
  }
}

export function getBoringAgentRuntimeDir(workspaceRoot: string, dirName: BoringAgentRuntimeDirName): string {
  return join(workspaceRoot, BORING_AGENT_DIR, dirName)
}

export function getBoringAgentNodePackageTarget(workspaceRoot: string, packageName: string): string {
  const parts = packageName.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid node package name: ${packageName}`)
  }
  return join(getBoringAgentRuntimePaths(workspaceRoot).nodeModules, ...parts)
}

export async function writeBoringAgentOwnershipMarker(
  targetDir: string,
  relPath: string,
  kind: BoringAgentOwnershipMarker['kind'] = 'runtime-dir',
): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  await writeFile(
    join(targetDir, BORING_AGENT_OWNERSHIP_MARKER_FILENAME),
    `${JSON.stringify(markerFor(relPath, kind), null, 2)}\n`,
    'utf8',
  )
}

export function writeBoringAgentOwnershipMarkerSync(
  targetDir: string,
  relPath: string,
  kind: BoringAgentOwnershipMarker['kind'] = 'runtime-dir',
): void {
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(
    join(targetDir, BORING_AGENT_OWNERSHIP_MARKER_FILENAME),
    `${JSON.stringify(markerFor(relPath, kind), null, 2)}\n`,
    'utf8',
  )
}

export async function ensureBoringAgentRuntimeLayout(workspaceRoot: string): Promise<BoringAgentRuntimePaths> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  await mkdir(paths.root, { recursive: true })

  const ownedRelPaths = BORING_AGENT_RUNTIME_DIR_NAMES.map((dirName) => `${BORING_AGENT_DIR}/${dirName}`)
  for (const relPath of ownedRelPaths) {
    await writeBoringAgentOwnershipMarker(join(workspaceRoot, relPath), relPath)
  }

  await writeFile(
    paths.ownershipManifest,
    `${JSON.stringify({
      v: BORING_AGENT_OWNERSHIP_MARKER_VERSION,
      owner: BORING_AGENT_OWNER,
      paths: ownedRelPaths,
    }, null, 2)}\n`,
    'utf8',
  )

  return paths
}

