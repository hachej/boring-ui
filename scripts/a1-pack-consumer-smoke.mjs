#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const EXPECTED_VERSION = '0.1.89'
const DEFAULT_TIMEOUT_MS = 120_000
const INSTALL_TIMEOUT_MS = 600_000
const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const tempBase = process.env.BORING_A1_PACK_TMPDIR
  ?? join(homedir(), '.cache', 'boring-a1-pack-smoke')

function truthyEnv(value) {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes'
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
}

function runTsc(input) {
  const result = spawnSync('pnpm', [
    'exec',
    'tsc',
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--jsx',
    'react-jsx',
    '--skipLibCheck',
    input.file,
  ], {
    cwd: input.cwd,
    env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase },
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
  })
  if (result.error) throw result.error
  return result
}

function assertTscPass(input) {
  console.log(`$ pnpm exec tsc --noEmit ${input.file}`)
  const result = runTsc(input)
  if (result.status !== 0) {
    console.error(result.stdout)
    console.error(result.stderr)
    throw new Error(`${input.label} expected TypeScript compile success, got ${result.status}`)
  }
}

function assertTscFail(input) {
  console.log(`$ pnpm exec tsc --noEmit ${input.file} # expected failure`)
  const result = runTsc(input)
  const output = `${result.stdout}\n${result.stderr}`
  if (result.status === 0 || !output.includes('has no exported member')) {
    console.error(result.stdout)
    console.error(result.stderr)
    throw new Error(`${input.label} expected missing-export TypeScript failure, got ${result.status}`)
  }
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
}

function assertArtifact(path) {
  if (!existsSync(path)) throw new Error(`required build artifact missing before pack: ${path}`)
}

function assertPackageVersion(packageDir, expectedName) {
  const manifest = readPackageJson(packageDir)
  assertEqual(manifest.name, expectedName, `${expectedName} package name`)
  assertEqual(manifest.version, EXPECTED_VERSION, `${expectedName} package version`)
}

function assertSafeGeneratedWorkRoot(workRoot) {
  const resolvedBase = resolve(tempBase)
  const resolvedWorkRoot = resolve(workRoot)
  if (!resolvedWorkRoot.startsWith(`${resolvedBase}/`)) {
    throw new Error(`refusing to remove work root outside temp base: ${resolvedWorkRoot}`)
  }
  if (!basename(resolvedWorkRoot).startsWith('boring-a1-pack-consumer-')) {
    throw new Error(`refusing to remove unexpected work root name: ${resolvedWorkRoot}`)
  }
}

async function main() {
  await mkdir(tempBase, { recursive: true })
  const workRoot = mkdtempSync(join(tempBase, 'boring-a1-pack-consumer-'))
  const retainDebug = truthyEnv(process.env.BORING_A1_PACK_RETAIN_DEBUG)
  let setupFailureSelfTest = false
  console.log(`A1 pack smoke generated workspace: ${workRoot}`)
  console.log(retainDebug
    ? 'A1 pack smoke retain flag enabled; generated workspace will be kept.'
    : 'A1 pack smoke will remove only its generated workspace in finally.')

  try {
    assertSafeGeneratedWorkRoot(workRoot)
    if (truthyEnv(process.env.BORING_A1_PACK_SELF_TEST_SETUP_FAILURE)) {
      setupFailureSelfTest = true
      throw new Error('intentional setup failure self-test')
    }

    const packDir = join(workRoot, 'packs')
    const consumerDir = join(workRoot, 'consumer')
    await mkdir(packDir, { recursive: true })
    await mkdir(consumerDir, { recursive: true })

    const agentDir = join(repoRoot, 'packages/agent')
    const workspaceDir = join(repoRoot, 'packages/workspace')
    const cliDir = join(repoRoot, 'packages/cli')

    assertPackageVersion(agentDir, '@hachej/boring-agent')
    assertPackageVersion(workspaceDir, '@hachej/boring-workspace')
    assertPackageVersion(cliDir, '@hachej/boring-ui-cli')

    run('pnpm', ['--filter', '@hachej/boring-workspace', 'build'], { timeoutMs: 900_000 })

    for (const artifact of [
      join(agentDir, 'dist/server/index.js'),
      join(agentDir, 'dist/shared/index.js'),
      join(agentDir, 'dist/front/index.js'),
      join(workspaceDir, 'dist/app-server.js'),
      join(workspaceDir, 'dist/server.js'),
      join(workspaceDir, 'dist/workspace.js'),
      join(cliDir, 'dist/index.js'),
      join(cliDir, 'dist/server/cli.js'),
    ]) assertArtifact(artifact)

    function pack(packageDir, expectedName) {
      const output = run('pnpm', ['--dir', packageDir, 'pack', '--json', '--pack-destination', packDir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        timeoutMs: 180_000,
      })
      const parsed = JSON.parse(output.trim())
      const entry = Array.isArray(parsed) ? parsed[0] : parsed
      const filename = entry.filename
      if (typeof filename !== 'string') throw new Error(`pnpm pack did not report filename for ${expectedName}`)
      const expectedBasename = `${expectedName.replace('@', '').replace('/', '-')}-${EXPECTED_VERSION}.tgz`
      assertEqual(basename(filename), expectedBasename, `${expectedName} tarball name/version`)
      return filename
    }

    const agentTarball = pack(agentDir, '@hachej/boring-agent')
    const workspaceTarball = pack(workspaceDir, '@hachej/boring-workspace')
    const cliTarball = pack(cliDir, '@hachej/boring-ui-cli')
    console.log(`agent tarball:     ${agentTarball}`)
    console.log(`workspace tarball: ${workspaceTarball}`)
    console.log(`cli tarball:       ${cliTarball}`)

    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.33.2',
      dependencies: {
        '@hachej/boring-agent': `file:${agentTarball}`,
        '@hachej/boring-workspace': `file:${workspaceTarball}`,
        '@hachej/boring-ui-cli': `file:${cliTarball}`,
      },
      devDependencies: {
        typescript: '6.0.3',
      },
      pnpm: {
        overrides: {
          '@hachej/boring-agent': `file:${agentTarball}`,
          '@hachej/boring-workspace': `file:${workspaceTarball}`,
          '@mariozechner/pi-coding-agent': 'npm:@earendil-works/pi-coding-agent@0.80.7',
          '@earendil-works/pi-ai': '0.80.7',
          '@perspective-dev/client': '4.4.1',
          '@perspective-dev/viewer': '4.4.1',
          '@perspective-dev/viewer-datagrid': '4.4.1',
          '@perspective-dev/viewer-d3fc': '4.4.1',
          'better-auth': '1.6.22',
        },
      },
    }, null, 2))

    run('pnpm', ['install', '--ignore-scripts'], { cwd: consumerDir, timeoutMs: INSTALL_TIMEOUT_MS })

    for (const [packageName, expectedVersion] of [
      ['@hachej/boring-agent', EXPECTED_VERSION],
      ['@hachej/boring-workspace', EXPECTED_VERSION],
      ['@hachej/boring-ui-cli', EXPECTED_VERSION],
    ]) {
      const manifest = JSON.parse(readFileSync(join(consumerDir, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8'))
      assertEqual(manifest.name, packageName, `${packageName} installed package name`)
      assertEqual(manifest.version, expectedVersion, `${packageName} installed package version`)
    }

    const typeProofDir = join(consumerDir, 'type-proof')
    await mkdir(typeProofDir, { recursive: true })
    writeFileSync(join(typeProofDir, 'server-positive.ts'), `
import { materializeAgentDirectory, type MaterializedAgentSourceV1 } from '@hachej/boring-agent/server'
const source: MaterializedAgentSourceV1 = Object.freeze({
  schemaVersion: 1,
  agentTypeId: 'claims-assistant',
  version: '1.0.0',
  instructions: 'typed proof',
  tools: [],
  declaredToolRefs: [],
})
void source
void materializeAgentDirectory
`)
    writeFileSync(join(typeProofDir, 'shared-type-negative.ts'), `
import type { MaterializedAgentSourceV1 } from '@hachej/boring-agent/shared'
const source: MaterializedAgentSourceV1 | undefined = undefined
void source
`)
    writeFileSync(join(typeProofDir, 'front-type-negative.ts'), `
import type { MaterializedAgentSourceV1 } from '@hachej/boring-agent/front'
const source: MaterializedAgentSourceV1 | undefined = undefined
void source
`)
    writeFileSync(join(typeProofDir, 'front-value-negative.ts'), `
import { materializeAgentDirectory } from '@hachej/boring-agent/front'
void materializeAgentDirectory
`)
    assertTscPass({ cwd: consumerDir, file: join(typeProofDir, 'server-positive.ts'), label: 'server MaterializedAgentSourceV1 import' })
    assertTscFail({ cwd: consumerDir, file: join(typeProofDir, 'shared-type-negative.ts'), label: 'shared MaterializedAgentSourceV1 import negative' })
    assertTscFail({ cwd: consumerDir, file: join(typeProofDir, 'front-type-negative.ts'), label: 'front MaterializedAgentSourceV1 import negative' })
    assertTscFail({ cwd: consumerDir, file: join(typeProofDir, 'front-value-negative.ts'), label: 'front materializeAgentDirectory import negative' })
    console.log('package TypeScript export proof ok')

    const probe = `
import assert from 'node:assert/strict'
import { materializeAgentDirectory } from '@hachej/boring-agent/server'
import * as shared from '@hachej/boring-agent/shared'
import * as front from '@hachej/boring-agent/front'
assert.equal(typeof materializeAgentDirectory, 'function')
assert.equal(Object.hasOwn(shared, 'materializeAgentDirectory'), false)
assert.equal(Object.hasOwn(front, 'materializeAgentDirectory'), false)
console.log('package runtime value export probe ok')
`
    run(process.execPath, ['--input-type=module', '--eval', probe], { cwd: consumerDir })

    const exampleDir = join(consumerDir, 'node_modules/@hachej/boring-agent/examples/trusted-authored-agent')
    const validate = run('pnpm', ['exec', 'boring-ui', 'agent', 'validate', exampleDir, '--json'], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const validatePayload = JSON.parse(validate)
    assertEqual(validatePayload.ok, true, 'installed-bin validate ok')
    assertEqual(validatePayload.agent.agentTypeId, 'claims-assistant', 'installed-bin validate agent id')
    assertEqual(validatePayload.agent.version, '1.0.0', 'installed-bin validate example version')
    console.log('installed-bin validate ok')

    const dev = spawnSync('pnpm', ['exec', 'boring-ui', 'agent', 'dev', exampleDir, '--prompt', 'pack smoke'], {
      cwd: consumerDir,
      env: { ...process.env, NO_COLOR: '1', TMPDIR: tempBase, BORING_UI_WORKSPACES_PATH: join(workRoot, 'workspaces.yaml') },
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    if (dev.error) throw dev.error
    if (dev.status !== 1 || !dev.stderr.includes('AUTHORED_AGENT_CATALOG_REQUIRED')) {
      console.error(dev.stdout)
      console.error(dev.stderr)
      throw new Error(`installed-bin dev fail-closed smoke expected AUTHORED_AGENT_CATALOG_REQUIRED, got ${dev.status}`)
    }
    console.log('installed-bin dev fail-closed smoke ok')
  } catch (error) {
    if (setupFailureSelfTest && error instanceof Error && error.message === 'intentional setup failure self-test') {
      console.log('A1 pack smoke setup-failure self-test reached cleanup path.')
    } else {
      throw error
    }
  } finally {
    if (retainDebug) {
      console.log(`A1 pack smoke retained generated workspace: ${workRoot}`)
    } else {
      assertSafeGeneratedWorkRoot(workRoot)
      await rm(workRoot, { recursive: true, force: true })
      if (existsSync(workRoot)) throw new Error(`A1 pack smoke cleanup failed: ${workRoot}`)
      console.log(`A1 pack smoke removed generated workspace: ${workRoot}`)
    }
  }

  if (setupFailureSelfTest) {
    if (existsSync(workRoot)) throw new Error(`A1 pack smoke setup-failure self-test leaked work root: ${workRoot}`)
    console.log(`A1 pack smoke setup-failure self-test proved root removed: ${workRoot}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}

await main()
