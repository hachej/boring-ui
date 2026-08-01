import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const vitest = join(repositoryRoot, 'node_modules/vitest/vitest.mjs')
const matrix = JSON.parse(readFileSync(join(repositoryRoot, 'docs/issues/1029/route-consumer-matrix.json'), 'utf8'))
const proofs = matrix.slice1Gate.compositionRoots
const routeContract = {
  required: matrix.routes
    .filter((route) => route.owner === 'agent-host')
    .flatMap((route) => route.final ?? []),
  allowed: [...new Set(matrix.routes.flatMap((route) => [
    ...route.current,
    ...(route.final ?? []),
  ]))],
}

await Promise.all(proofs.map((proof) => new Promise((resolve, reject) => {
  process.stdout.write(`\n# Agent Host composition proof: ${proof.id}\n`)
  const cwd = join(repositoryRoot, proof.packageRoot)
  const proofFile = relative(cwd, join(repositoryRoot, proof.proof))
  const child = spawn(
    process.execPath,
    [vitest, 'run', proofFile, '--testNamePattern', proof.testName, '--configLoader', 'runner'],
    {
      cwd,
      env: {
        ...process.env,
        BORING_AGENTHOST_EXPECTED_ROUTES: JSON.stringify(routeContract),
        BORING_PLUGIN_FRONT_VITE_CACHE_DIR: join('/tmp', `boring-agenthost-proof-vite-${process.pid}-${proof.id}`),
      },
      stdio: 'inherit',
    },
  )
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (code === 0) resolve()
    else reject(new Error(`composition proof ${proof.id} failed (${signal ?? code ?? 'unknown'})`))
  })
})))

process.stdout.write('\n#1029 Slice 1 composed route/auth proofs passed for all seven named roots\n')
