#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
const workRoot = mkdtempSync(join(tmpdir(), 'boring-a1-declarative-pack-'))

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: options.encoding,
    stdio: options.stdio ?? 'inherit',
    timeout: options.timeout ?? 600_000,
  })
}

function pack(packageDir, destination) {
  const output = run('pnpm', [
    '--dir', packageDir,
    'pack',
    '--json',
    '--pack-destination', destination,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const parsed = JSON.parse(output.trim())
  const filename = (Array.isArray(parsed) ? parsed[0] : parsed).filename
  if (typeof filename !== 'string') throw new Error(`pack did not report a filename for ${packageDir}`)
  return filename
}

async function main() {
  // Pack only freshly built artifacts so the proof cannot accidentally validate
  // stale dist output from another branch or worktree.
  run('pnpm', ['build:packages'], { timeout: 1_800_000 })

  const packDir = join(workRoot, 'packs')
  const consumerDir = join(workRoot, 'consumer')
  const agentDir = join(consumerDir, 'agent-source')
  await mkdir(packDir, { recursive: true })
  await mkdir(agentDir, { recursive: true })

  const agentTarball = pack(join(repoRoot, 'packages/agent'), packDir)
  const cliTarball = pack(join(repoRoot, 'packages/cli'), packDir)
  if (!basename(agentTarball).endsWith(`-${version}.tgz`)) throw new Error('agent tarball version mismatch')
  if (!basename(cliTarball).endsWith(`-${version}.tgz`)) throw new Error('CLI tarball version mismatch')

  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      '@hachej/boring-agent': `file:${agentTarball}`,
      '@hachej/boring-ui-cli': `file:${cliTarball}`,
    },
  }, null, 2))
  writeFileSync(join(consumerDir, 'pnpm-workspace.yaml'), [
    'overrides:',
    `  '@hachej/boring-agent': 'file:${agentTarball}'`,
    "  '@mariozechner/pi-coding-agent': 'npm:@earendil-works/pi-coding-agent@0.80.7'",
    "  '@earendil-works/pi-ai': '0.80.7'",
    "  '@perspective-dev/client': '4.4.1'",
    "  '@perspective-dev/viewer': '4.4.1'",
    "  '@perspective-dev/viewer-datagrid': '4.4.1'",
    "  '@perspective-dev/viewer-d3fc': '4.4.1'",
    "  'better-auth': '1.6.22'",
    '',
  ].join('\n'))
  run('pnpm', ['install', '--ignore-scripts'], { cwd: consumerDir })

  const manifest = {
    schemaVersion: 1,
    definitionId: 'claims-assistant',
    version: '2026.07.20',
    label: 'Claims assistant',
    description: 'Packed consumer proof.',
    instructionsRef: 'instructions.md',
  }
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify(manifest))
  writeFileSync(join(agentDir, 'instructions.md'), 'Handle claims with care.\n')

  const runtimeProbe = `
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  materializeAgentDirectory,
} from '@hachej/boring-agent/server'
import { ERROR_CODES } from '@hachej/boring-agent/shared'
const directory = ${JSON.stringify(agentDir)}
const manifest = ${JSON.stringify(manifest)}
const source = await materializeAgentDirectory({ directory })
assert.deepEqual(Object.keys(source).sort(), [
  'agentTypeId', 'description', 'instructions', 'label', 'schemaVersion', 'version',
])
assert.equal(Object.isFrozen(source), true)
assert.equal(ERROR_CODES.includes('AUTHORED_AGENT_TOOL_COLLISION'), true)
assert.equal(ERROR_CODES.includes('AUTHORED_AGENT_CATALOG_REQUIRED'), false)
writeFileSync(join(directory, 'agent.json'), JSON.stringify({ ...manifest, toolRefs: ['legacy.tool'] }))
await assert.rejects(
  materializeAgentDirectory({ directory }),
  (error) => error?.code === 'AUTHORED_AGENT_REFERENCE_UNSUPPORTED' &&
    error?.field === 'toolRefs' && !error?.message.includes('legacy.tool'),
)
writeFileSync(join(directory, 'agent.json'), JSON.stringify(manifest))
console.log('packed Agent declarative source: OK')
`
  run(process.execPath, ['--input-type=module', '--eval', runtimeProbe], { cwd: consumerDir })

  const serverTypes = readFileSync(
    join(consumerDir, 'node_modules/@hachej/boring-agent/dist/server/index.d.ts'),
    'utf8',
  )
  for (const removed of [
    'AuthoredAgentToolCatalog',
    'MaterializedAgentSourceV1',
    'declaredToolRefs',
    'toolCatalog',
  ]) {
    if (serverTypes.includes(removed)) throw new Error(`packed Agent declaration retained ${removed}`)
  }
  if (!serverTypes.includes('AuthoredAgentSourceV1')) {
    throw new Error('packed Agent declaration is missing AuthoredAgentSourceV1')
  }

  const cliBin = join(consumerDir, 'node_modules/@hachej/boring-ui-cli/dist/index.js')
  const success = spawnSync(process.execPath, [cliBin, 'agent', 'validate', agentDir, '--json'], {
    cwd: consumerDir,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (success.error) throw success.error
  if (success.status !== 0) throw new Error(`packed CLI validate failed: ${success.stderr}`)
  const payload = JSON.parse(success.stdout)
  if (payload.ok !== true || Object.hasOwn(payload.agent, 'refs')) {
    throw new Error('packed CLI returned a non-declarative success payload')
  }

  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify({
    ...manifest,
    toolRefs: ['legacy.tool'],
  }))
  const failure = spawnSync(process.execPath, [cliBin, 'agent', 'validate', agentDir, '--json'], {
    cwd: consumerDir,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (failure.error) throw failure.error
  const errorPayload = JSON.parse(failure.stderr)
  if (
    failure.status !== 1 ||
    failure.stdout !== '' ||
    errorPayload.error?.code !== 'AUTHORED_AGENT_REFERENCE_UNSUPPORTED' ||
    failure.stderr.includes('legacy.tool') ||
    failure.stderr.includes(agentDir)
  ) {
    throw new Error('packed CLI legacy-selector rejection was not stable and redacted')
  }

  console.log('packed Agent/CLI declarative consumer smoke: OK')
}

try {
  await main()
} finally {
  const resolved = resolve(workRoot)
  const base = resolve(tmpdir())
  if (resolved.startsWith(`${base}/`) && basename(resolved).startsWith('boring-a1-declarative-pack-')) {
    await rm(resolved, { recursive: true, force: true })
  }
}
