#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

const baseRef = process.env.TEST_BASE_REF || process.env.GITHUB_BASE_REF || 'main'
const base = baseRef.startsWith('origin/') ? baseRef : `origin/${baseRef}`
const concurrency = process.env.WORKSPACE_CONCURRENCY || '4'

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function output(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}

try {
  output('git', ['rev-parse', '--verify', base])
} catch {
  run('git', ['fetch', '--no-tags', '--depth=1', 'origin', `${baseRef.replace(/^origin\//, '')}:refs/remotes/origin/${baseRef.replace(/^origin\//, '')}`])
}

const workspaceJson = output('pnpm', ['-r', 'list', '--depth', '-1', '--json'])
const root = output('git', ['rev-parse', '--show-toplevel'])
const workspaces = JSON.parse(workspaceJson)
  .filter((workspace) => workspace.name && workspace.path !== root)
  .map((workspace) => ({
    name: workspace.name,
    path: workspace.path,
    rel: relative(root, workspace.path).replaceAll('\\', '/'),
  }))

const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]))
const packageByRel = [...workspaces].sort((a, b) => b.rel.length - a.rel.length)
const changedFiles = output('git', ['diff', '--name-only', `${base}...HEAD`])
  .split('\n')
  .filter(Boolean)

const globalTestFiles = new Set([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'vitest.config.ts',
])
const globalTestPrefixes = [
  '.github/workflows/',
  'scripts/',
]

const changedNames = new Set()
let globalChange = false
for (const file of changedFiles) {
  if (globalTestFiles.has(file) || globalTestPrefixes.some((prefix) => file.startsWith(prefix))) {
    globalChange = true
    break
  }
  const owner = packageByRel.find((workspace) => file === workspace.rel || file.startsWith(`${workspace.rel}/`))
  if (owner) changedNames.add(owner.name)
}

if (globalChange) {
  console.log('test-changed: global test input changed; running full test suite')
  run('pnpm', ['test'])
}

if (changedNames.size === 0) {
  console.log(`test-changed: no workspace package changes since ${base}; skipping`)
  process.exit(0)
}

function workspaceManifest(workspace) {
  const packageJsonPath = `${workspace.path}/package.json`
  if (!existsSync(packageJsonPath)) return {}
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
}

const depsByName = new Map()
const dependentsByName = new Map(workspaces.map((workspace) => [workspace.name, new Set()]))
for (const workspace of workspaces) {
  const manifest = workspaceManifest(workspace)
  const dependencyNames = new Set()
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (workspaceByName.has(name)) dependencyNames.add(name)
    }
  }
  depsByName.set(workspace.name, dependencyNames)
  for (const dependency of dependencyNames) dependentsByName.get(dependency)?.add(workspace.name)
}

function closure(seeds, graph) {
  const result = new Set(seeds)
  const queue = [...seeds]
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of graph.get(queue[index]) ?? []) {
      if (!result.has(next)) {
        result.add(next)
        queue.push(next)
      }
    }
  }
  return result
}

function hasScript(name, scriptName) {
  const workspace = workspaceByName.get(name)
  if (!workspace) return false
  const manifest = workspaceManifest(workspace)
  return Boolean(manifest.scripts?.[scriptName])
}

const checkNames = closure(changedNames, dependentsByName)
const buildNames = new Set(
  [...closure(checkNames, depsByName)].filter((name) => {
    const workspace = workspaceByName.get(name)
    return workspace && !workspace.rel.startsWith('apps/') && hasScript(name, 'build')
  }),
)
const testNames = new Set([...checkNames].filter((name) => hasScript(name, 'test')))

function filters(names) {
  return [...names].sort().flatMap((name) => ['--filter', name])
}

console.log(`test-changed: changed=${[...changedNames].sort().join(', ')}`)
console.log(`test-changed: testing changed packages + dependents=${[...checkNames].sort().join(', ')}`)
console.log(`test-changed: test-capable workspaces=${[...testNames].sort().join(', ') || '(none)'}`)
console.log(`test-changed: prebuilding package/plugin dependencies=${[...buildNames].sort().join(', ') || '(none)'}`)

if (buildNames.size > 0) run('pnpm', ['-r', ...filters(buildNames), `--workspace-concurrency=${concurrency}`, 'run', 'build'])
if (testNames.size === 0) {
  console.log('test-changed: no changed workspaces with test scripts; skipping')
  process.exit(0)
}
run('pnpm', ['-r', ...filters(testNames), `--workspace-concurrency=${concurrency}`, 'run', 'test'])
