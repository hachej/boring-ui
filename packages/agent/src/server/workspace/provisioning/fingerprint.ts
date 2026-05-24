import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { RuntimeNodePackageSpec, RuntimePythonSpec } from './types'

const FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/

export interface NodeRuntimeFingerprintInput {
  packages: RuntimeNodePackageSpec[]
  nodeVersion: string
  npmVersion: string
}

export interface PythonRuntimeFingerprintInput {
  packages: RuntimePythonSpec[]
  pythonVersion: string
  uvVersion: string
}

export function isValidFingerprint(value: string): boolean {
  return FINGERPRINT_RE.test(value.trim())
}

function normalizeSource(value: string | URL | undefined): string | undefined {
  if (value === undefined) return undefined
  return String(value)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export function createRuntimeFingerprint(input: unknown): string {
  const hash = createHash('sha256')
  hash.update(stableStringify(input))
  return `sha256:${hash.digest('hex')}`
}

export function createNodeRuntimeFingerprint(input: NodeRuntimeFingerprintInput): string {
  return createRuntimeFingerprint({
    kind: 'node',
    nodeVersion: input.nodeVersion,
    npmVersion: input.npmVersion,
    packages: input.packages.map((pkg) => ({
      id: pkg.id,
      packageName: pkg.packageName,
      packageRoot: normalizeSource(pkg.packageRoot),
      version: pkg.version,
      expectedBins: pkg.expectedBins ?? [],
    })),
  })
}

export function createPythonRuntimeFingerprint(input: PythonRuntimeFingerprintInput): string {
  return createRuntimeFingerprint({
    kind: 'python',
    pythonVersion: input.pythonVersion,
    uvVersion: input.uvVersion,
    packages: input.packages.map((pkg) => ({
      id: pkg.id,
      projectFile: normalizeSource(pkg.projectFile),
      packageName: pkg.packageName,
      packageRoot: normalizeSource(pkg.packageRoot),
      version: pkg.version,
      extraLibs: pkg.extraLibs ?? [],
      env: Object.fromEntries(
        Object.entries(pkg.env ?? {}).map(([key, value]) => [key, normalizeSource(value)]),
      ),
      expectedBins: pkg.expectedBins ?? [],
    })),
  })
}

export async function readFingerprint(path: string): Promise<string | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }

  const fingerprint = text.trim()
  return isValidFingerprint(fingerprint) ? fingerprint : null
}

export async function writeFingerprint(path: string, fingerprint: string): Promise<void> {
  if (!isValidFingerprint(fingerprint)) {
    throw new Error(`Invalid runtime fingerprint: ${fingerprint}`)
  }

  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(`${fingerprint}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }
}

export async function writeFingerprintAfterSuccessfulInstall(options: {
  fingerprintPath: string
  fingerprint: string
  install: () => Promise<void>
}): Promise<void> {
  await options.install()
  await writeFingerprint(options.fingerprintPath, options.fingerprint)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

export async function shouldInstallRuntime(options: {
  fingerprintPath: string
  desiredFingerprint: string
  expectedOutputs: string[]
  exists?: (path: string) => Promise<boolean>
}): Promise<boolean> {
  const currentFingerprint = await readFingerprint(options.fingerprintPath)
  if (currentFingerprint !== options.desiredFingerprint) return true

  const checkExists = options.exists ?? exists
  for (const output of options.expectedOutputs) {
    if (!(await checkExists(output))) return true
  }

  return false
}
