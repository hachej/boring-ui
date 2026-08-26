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

test('standalone host opts into BORING_AGENT_SESSION_ROOT for its ledger', async () => {
  const workspaceRoot = await makeTempDir('boring-standalone-ledger-ws-')
  const sessionRoot = await makeTempDir('boring-standalone-ledger-env-')
  setEnvForTest('BORING_AGENT_SESSION_ROOT', sessionRoot)

  const app = await createStandaloneAgentHostApp({ workspaceRoot, logger: false })

  try {
    expect(existsSync(join(sessionRoot, '.agent-request-ledger.sqlite'))).toBe(true)
    expect(existsSync(join(workspaceRoot, '.boring'))).toBe(false)
  } finally {
    await app.close()
  }
}, 120_000)

test('standalone host keeps its legacy .boring ledger without a host root', async () => {
  const workspaceRoot = await makeTempDir('boring-standalone-ledger-ws-')
  setEnvForTest('BORING_AGENT_SESSION_ROOT', undefined)

  const app = await createStandaloneAgentHostApp({ workspaceRoot, logger: false })

  try {
    expect(existsSync(join(workspaceRoot, '.boring', 'agent-request-ledger.sqlite'))).toBe(true)
  } finally {
    await app.close()
  }
}, 120_000)

