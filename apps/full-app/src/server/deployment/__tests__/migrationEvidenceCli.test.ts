import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { createAgentHostMigrationSetEvidence } from '../approvedHostRelease.js'

const execFileAsync = promisify(execFile)
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../../..')
const DRIZZLE_ROOT = resolve(REPOSITORY_ROOT, 'packages/core/drizzle')
const EVIDENCE_SCRIPT = resolve(REPOSITORY_ROOT, 'scripts/self-host/agent-host-migration-evidence.mjs')
const DEPLOYMENT_SOURCES = [
  'apps/full-app/src/server/migrate.ts',
  'packages/core/src/server/migrations.ts',
  'packages/core/src/server/db/migrate.ts',
  'plugins/boring-automation/src/server/migrations.ts',
] as const

const bytes = async (file: string) => new Uint8Array(await readFile(file))

describe('AgentHost build migration evidence', () => {
  it('matches the application codec for the exact real migration closure', async () => {
    const journal = JSON.parse(await readFile(resolve(DRIZZLE_ROOT, 'meta/_journal.json'), 'utf8'))
    const sqlFiles = (await readdir(DRIZZLE_ROOT)).filter((file) => file.endsWith('.sql')).sort()
    const applicationEvidence = await createAgentHostMigrationSetEvidence(
      journal,
      await Promise.all(sqlFiles.map(async (file) => ({ file, bytes: await bytes(resolve(DRIZZLE_ROOT, file)) }))),
      await Promise.all(DEPLOYMENT_SOURCES.map(async (file) => ({ file, bytes: await bytes(resolve(REPOSITORY_ROOT, file)) }))),
    )
    const { stdout, stderr } = await execFileAsync(process.execPath, [EVIDENCE_SCRIPT], { cwd: REPOSITORY_ROOT })
    const buildEvidence = JSON.parse(stdout)

    expect(stderr).toBe('')
    expect(buildEvidence).toEqual(applicationEvidence)
    expect(buildEvidence.deploymentSources.map((source: { file: string }) => source.file)).toEqual(DEPLOYMENT_SOURCES)
    expect(buildEvidence.currentEpoch).toBe(sqlFiles.length)
  })

  it('emits only bounded digest and epoch GitHub outputs', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [EVIDENCE_SCRIPT, '--github-output'], { cwd: REPOSITORY_ROOT })
    const lines = stdout.trim().split('\n')

    expect(stderr).toBe('')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^migration_set_digest=sha256:[a-f0-9]{64}$/)
    expect(lines[1]).toMatch(/^current_epoch=[0-9]+$/)
  })
})
