import type { BwrapResourceLimits } from '@hachej/boring-sandbox/providers'

const FILE_SIZE_BLOCKS_PER_MIB = 2048
const KIB_PER_MIB = 1024

export interface WorkerConfig {
  workspaceRoot: string
  internalToken: string
  port: number
  host: string
  execConcurrency: number
  bwrapNetwork: 'isolated' | 'shared'
  resourceLimits: BwrapResourceLimits
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function bwrapNetworkEnv(): 'isolated' | 'shared' {
  const raw = process.env.BORING_WORKER_BWRAP_NETWORK?.trim().toLowerCase()
  return raw === 'shared' ? 'shared' : 'isolated'
}

function resourceLimitsEnv(): BwrapResourceLimits {
  return {
    cpuSeconds: numberEnv('BORING_WORKER_EXEC_CPU_SECONDS', 30),
    fileSizeBlocks: numberEnv('BORING_WORKER_EXEC_FILE_SIZE_MIB', 64) * FILE_SIZE_BLOCKS_PER_MIB,
    maxProcesses: numberEnv('BORING_WORKER_EXEC_MAX_PROCESSES', 512),
    openFiles: numberEnv('BORING_WORKER_EXEC_OPEN_FILES', 256),
    virtualMemoryKb: numberEnv('BORING_WORKER_EXEC_VIRTUAL_MEMORY_MIB', 1024) * KIB_PER_MIB,
  }
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    workspaceRoot: requireEnv('BORING_WORKER_WORKSPACE_ROOT'),
    internalToken: requireEnv('BORING_WORKER_INTERNAL_TOKEN'),
    port: numberEnv('PORT', 3000),
    host: process.env.HOST?.trim() || '0.0.0.0',
    execConcurrency: numberEnv('BORING_WORKER_EXEC_CONCURRENCY', 2),
    bwrapNetwork: bwrapNetworkEnv(),
    resourceLimits: resourceLimitsEnv(),
  }
}
