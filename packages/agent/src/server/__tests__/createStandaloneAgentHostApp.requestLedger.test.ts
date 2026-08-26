import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { getEnv, restoreEnvForTest, setEnvForTest } from '../config/env'
import { createTestStandaloneAgentHostApp as createStandaloneAgentHostApp } from '@agent-test-host'

const tempDirs: string[] = []
const ORIGINAL_SESSION_ROOT = getEnv('BORING_AGENT_SESSION_ROOT')

afterEach(async () => {
  restoreEnvForTest('BORING_AGENT_SESSION_ROOT', ORIGINAL_SESSION_ROOT)
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

test('standalone host writes the request ledger to an explicit host-owned path', async () => {
  const workspaceRoot = await makeTempDir('boring-standalone-ledger-ws-')
  const hostState = await makeTempDir('boring-standalone-ledger-host-')
  const requestLedgerPath = join(hostState, 'agent-state', 'request-ledger.sqlite')
  setEnvForTest('BORING_AGENT_SESSION_ROOT', await makeTempDir('boring-standalone-ledger-env-'))

  const app = await createStandaloneAgentHostApp({
    workspaceRoot,
    sessionRoot: await makeTempDir('boring-standalone-ledger-sessions-'),
    requestLedgerPath,
    logger: false,
  })

  try {
    expect(existsSync(requestLedgerPath)).toBe(true)
    expect(existsSync(join(workspaceRoot, '.boring'))).toBe(false)
  } finally {
    await app.close()
  }
}, 120_000)

test('standalone host falls back to the host session root, option before env', async () => {
  const workspaceRoot = await makeTempDir('boring-standalone-ledger-ws-')
  const sessionRoot = await makeTempDir('boring-standalone-ledger-sessions-')
  const envRoot = await makeTempDir('boring-standalone-ledger-env-')
  setEnvForTest('BORING_AGENT_SESSION_ROOT', envRoot)

  const app = await createStandaloneAgentHostApp({ workspaceRoot, sessionRoot, logger: false })

  try {
    expect(existsSync(join(sessionRoot, '.agent-request-ledger.sqlite'))).toBe(true)
    expect(existsSync(join(envRoot, '.agent-request-ledger.sqlite'))).toBe(false)
    expect(existsSync(join(workspaceRoot, '.boring'))).toBe(false)
  } finally {
    await app.close()
  }
}, 120_000)

test('standalone host falls back to BORING_AGENT_SESSION_ROOT when no option is set', async () => {
  const workspaceRoot = await makeTempDir('boring-standalone-ledger-ws-')
  const envRoot = await makeTempDir('boring-standalone-ledger-env-')
  setEnvForTest('BORING_AGENT_SESSION_ROOT', envRoot)

  const app = await createStandaloneAgentHostApp({ workspaceRoot, logger: false })

  try {
    expect(existsSync(join(envRoot, '.agent-request-ledger.sqlite'))).toBe(true)
    expect(existsSync(join(workspaceRoot, '.boring'))).toBe(false)
  } finally {
    await app.close()
  }
}, 120_000)

test('standalone host keeps the legacy workspace ledger when no host path is configured', async () => {
  const workspaceRoot = await makeTempDir('boring-standalone-ledger-ws-')
  setEnvForTest('BORING_AGENT_SESSION_ROOT', undefined)

  const app = await createStandaloneAgentHostApp({ workspaceRoot, logger: false })

  try {
    expect(existsSync(join(workspaceRoot, '.boring', 'agent-request-ledger.sqlite'))).toBe(true)
  } finally {
    await app.close()
  }
}, 120_000)
