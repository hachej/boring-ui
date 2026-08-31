import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BORING_FACTORY_RESOURCE_CONTRACT_VERSION,
  FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
  FACTORY_WORKER_AGENT_TYPE_ID,
} from '../shared/constants'
import type {
  BoringFactoryResourceManifestV1,
  BoringFactoryResources,
} from '../shared/types'

export {
  BORING_FACTORY_RESOURCE_CONTRACT_VERSION,
  FACTORY_AGENT_TYPE_IDS,
  FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
  FACTORY_WORKER_AGENT_TYPE_ID,
} from '../shared/constants'
export type {
  BoringFactoryResourceManifestV1,
  BoringFactoryResources,
  FactoryAgentTypeId,
} from '../shared/types'

const SHA256 = /^[a-f0-9]{64}$/

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function readManifest(resourceRoot: string): {
  readonly bytes: string
  readonly manifest: BoringFactoryResourceManifestV1
} {
  const bytes = readFileSync(path.join(resourceRoot, 'resource-manifest.json'), 'utf8')
  const parsed = JSON.parse(bytes) as Partial<BoringFactoryResourceManifestV1>
  if (
    parsed.contractVersion !== BORING_FACTORY_RESOURCE_CONTRACT_VERSION
    || !parsed.files
    || typeof parsed.files !== 'object'
    || Array.isArray(parsed.files)
  ) {
    throw new Error('invalid Boring Factory resource manifest')
  }
  return { bytes, manifest: parsed as BoringFactoryResourceManifestV1 }
}

function listResourceFiles(
  resourceRoot: string,
  relativeDirectory = '',
): string[] {
  const directory = path.join(resourceRoot, relativeDirectory)
  const files: string[] = []
  for (const name of readdirSync(directory).sort()) {
    const relativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), name)
    if (relativePath === 'resource-manifest.json') continue
    const absolutePath = path.join(resourceRoot, relativePath)
    const info = lstatSync(absolutePath)
    if (info.isSymbolicLink()) {
      throw new Error(`Boring Factory resource must not be a symlink: ${relativePath}`)
    }
    if (info.isDirectory()) {
      files.push(...listResourceFiles(resourceRoot, relativePath))
    } else if (info.isFile()) {
      files.push(relativePath)
    } else {
      throw new Error(`Boring Factory resource must be a regular file: ${relativePath}`)
    }
  }
  return files
}

function verifyResources(resourceRoot: string, manifest: BoringFactoryResourceManifestV1): void {
  const canonicalRoot = realpathSync(resourceRoot)
  const manifestFiles = Object.keys(manifest.files).sort()
  const actualFiles = listResourceFiles(resourceRoot)
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifestFiles)) {
    throw new Error('Boring Factory resource file set does not match manifest')
  }
  for (const [relativePath, expectedDigest] of Object.entries(manifest.files)) {
    if (
      !relativePath
      || path.isAbsolute(relativePath)
      || relativePath.split('/').includes('..')
      || !SHA256.test(expectedDigest)
    ) {
      throw new Error(`invalid Boring Factory resource entry: ${relativePath}`)
    }
    const absolutePath = realpathSync(path.resolve(resourceRoot, relativePath))
    const relativeToRoot = path.relative(canonicalRoot, absolutePath)
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Boring Factory resource escapes package root: ${relativePath}`)
    }
    if (!statSync(absolutePath).isFile()) {
      throw new Error(`Boring Factory resource is not a file: ${relativePath}`)
    }
    if (sha256(readFileSync(absolutePath)) !== expectedDigest) {
      throw new Error(`Boring Factory resource digest mismatch: ${relativePath}`)
    }
  }
}

/**
 * Resolves and verifies the inert Factory profiles and Worker procedures from
 * this exact installed artifact. The caller still decides which seats and
 * addressed runtimes receive them; this function grants no executable authority.
 */
export function resolveBoringFactoryResources(): BoringFactoryResources {
  const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const resourceRoot = path.join(distRoot, 'resources')
  const { bytes, manifest } = readManifest(resourceRoot)
  verifyResources(resourceRoot, manifest)

  return Object.freeze({
    resourceRoot,
    skillRoot: path.join(resourceRoot, 'skills'),
    resourceDigest: `sha256:${sha256(bytes)}`,
    manifest,
    agentSources: Object.freeze({
      [FACTORY_ORCHESTRATOR_AGENT_TYPE_ID]: path.join(
        resourceRoot,
        'agents',
        FACTORY_ORCHESTRATOR_AGENT_TYPE_ID,
      ),
      [FACTORY_WORKER_AGENT_TYPE_ID]: path.join(
        resourceRoot,
        'agents',
        FACTORY_WORKER_AGENT_TYPE_ID,
      ),
    }),
  })
}
