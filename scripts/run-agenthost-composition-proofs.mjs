import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const vitest = realpathSync(join(repositoryRoot, 'node_modules/vitest/vitest.mjs'))
const matrix = JSON.parse(readFileSync(join(repositoryRoot, 'docs/issues/1029/route-consumer-matrix.json'), 'utf8'))
const proofs = matrix.finalGate.compositionRoots
for (const proof of proofs) await new Promise((resolve, reject) => {
  process.stdout.write(`\n# Agent Host composition proof: ${proof.id}\n`)
  const cwd = join(repositoryRoot, proof.packageRoot)
  const proofFile = relative(cwd, join(repositoryRoot, proof.proof))
  const viteCacheRoot = mkdtempSync(join(tmpdir(), `boring-agenthost-proof-${proof.id}-`))
  mkdirSync(join(viteCacheRoot, 'ssr'), { recursive: true })
  const required = matrix.routes
    .filter((route) => proof.applicableRouteIds.includes(route.id))
    .flatMap((route) => route.final ?? [])
  const routeContract = {
    required,
    allowed: required,
    classified: [...new Set(matrix.routes.flatMap((route) => route.final ?? []))],
  }
  const child = spawn(
    process.execPath,
    [vitest, 'run', proofFile, '--testNamePattern', proof.testName, '--configLoader', 'runner'],
    {
      cwd,
      env: {
        ...process.env,
        BORING_AGENTHOST_EXPECTED_ROUTES: JSON.stringify(routeContract),
        BORING_PLUGIN_FRONT_VITE_CACHE_DIR: viteCacheRoot,
      },
      stdio: 'inherit',
    },
  )
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (code === 0) resolve()
    else reject(new Error(`composition proof ${proof.id} failed (${signal ?? code ?? 'unknown'})`))
  })
})

process.stdout.write('\n#1029 final composed route/auth proofs passed for all seven named roots\n')
