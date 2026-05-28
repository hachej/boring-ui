import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { getEnv } from '../../config/env'
import { createLogger } from '../../logging'
import { getBoringAgentRuntimePaths, writeBoringAgentOwnershipMarkerSync } from '../../workspace/runtimeLayout'

const log = createLogger('libs-preinstall')

const CACHE_BASE = '/var/cache/boring-agent/venvs'
const SYSTEM_VENV_PATH = '/opt/venv'
const INSTALL_TIMEOUT_MS = 120_000

export interface LibsPreinstallConfig {
  pythonPackages?: string[]
  workspaceRoot?: string
}

export interface PreinstallResult {
  tier1VenvPath: string | null
  tier2VenvPath: string | null
  skipped: boolean
}

function hashPackageList(packages: string[]): string {
  const sorted = [...packages].sort()
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16)
}

function findPythonInstaller(): 'uv' | 'pip' {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore', timeout: 5_000 })
    return 'uv'
  } catch {
    return 'pip'
  }
}

function installWithUv(venvPath: string, packages: string[]): void {
  execFileSync('uv', ['venv', venvPath, '--seed'], {
    stdio: 'ignore',
    timeout: INSTALL_TIMEOUT_MS,
  })
  execFileSync(
    'uv',
    ['pip', 'install', '--python', join(venvPath, 'bin', 'python3'), ...packages],
    { stdio: 'pipe', timeout: INSTALL_TIMEOUT_MS },
  )
}

function installWithPip(venvPath: string, packages: string[]): void {
  execFileSync('python3', ['-m', 'venv', venvPath], {
    stdio: 'ignore',
    timeout: INSTALL_TIMEOUT_MS,
  })
  execFileSync(join(venvPath, 'bin', 'pip'), ['install', ...packages], {
    stdio: 'pipe',
    timeout: INSTALL_TIMEOUT_MS,
  })
}

export function ensureTier1Venv(packages: string[]): string | null {
  if (packages.length === 0) {
    log.info('no python_packages configured, skipping tier-1 venv')
    return null
  }

  if (existsSync(join(SYSTEM_VENV_PATH, 'bin', 'python3'))) {
    log.info('tier-1 venv already exists at /opt/venv (Dockerfile-built)', {
      path: SYSTEM_VENV_PATH,
    })
    return SYSTEM_VENV_PATH
  }

  const hash = hashPackageList(packages)
  const cachePath = join(CACHE_BASE, hash)

  if (existsSync(join(cachePath, 'bin', 'python3'))) {
    log.info('tier-1 venv cache hit', { hash, cachePath, packageCount: packages.length })
    return cachePath
  }

  log.info('installing tier-1 venv', { hash, cachePath, packageCount: packages.length })
  const start = Date.now()

  mkdirSync(CACHE_BASE, { recursive: true })
  const installer = findPythonInstaller()
  log.info('using installer', { installer })

  if (installer === 'uv') {
    installWithUv(cachePath, packages)
  } else {
    installWithPip(cachePath, packages)
  }

  const durationMs = Date.now() - start
  log.info('tier-1 venv installed', { hash, cachePath, packageCount: packages.length, durationMs })

  return cachePath
}

export function ensureTier2Venv(workspaceRoot: string, tier1Path: string | null): string {
  const venvPath = getBoringAgentRuntimePaths(workspaceRoot).venv

  if (existsSync(join(venvPath, 'bin', 'python3'))) {
    log.info('tier-2 overlay venv exists', { venvPath })
    return venvPath
  }

  log.info('creating tier-2 overlay venv', { venvPath, systemSitePackages: !!tier1Path })

  const args = ['-m', 'venv', venvPath]
  if (tier1Path) {
    args.push('--system-site-packages')
  }

  const python = tier1Path
    ? join(tier1Path, 'bin', 'python3')
    : 'python3'

  execFileSync(python, args, { stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS })
  writeBoringAgentOwnershipMarkerSync(venvPath, '.boring-agent/venv')

  log.info('tier-2 overlay venv created', { venvPath })
  return venvPath
}

export function buildVenvBwrapArgs(tier1Path: string | null): string[] {
  if (!tier1Path) return []

  const args = ['--ro-bind', tier1Path, SYSTEM_VENV_PATH]

  return args
}

export function buildVenvEnv(tier1Path: string | null, workspaceRoot: string): Record<string, string> {
  const paths = getBoringAgentRuntimePaths(workspaceRoot)
  const tier2Bin = paths.venvBin
  const tier1Bin = tier1Path ? join(SYSTEM_VENV_PATH, 'bin') : null

  const pathParts = [tier2Bin]
  if (tier1Bin) pathParts.push(tier1Bin)
  const hostPath = getEnv('PATH')
  if (hostPath) pathParts.push(...hostPath.split(':'))

  return {
    PATH: pathParts.join(':'),
    VIRTUAL_ENV: paths.venv,
  }
}

export function parsePackagesEnv(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim().length === 0) return []
  return envValue.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
}

export async function preinstallLibs(config: LibsPreinstallConfig): Promise<PreinstallResult> {
  const packages = config.pythonPackages ?? []

  if (packages.length === 0 && !config.workspaceRoot) {
    log.info('no packages and no workspace — skipping preinstall')
    return { tier1VenvPath: null, tier2VenvPath: null, skipped: true }
  }

  const tier1Path = ensureTier1Venv(packages)

  let tier2Path: string | null = null
  if (config.workspaceRoot) {
    tier2Path = ensureTier2Venv(config.workspaceRoot, tier1Path)
  }

  return { tier1VenvPath: tier1Path, tier2VenvPath: tier2Path, skipped: false }
}
