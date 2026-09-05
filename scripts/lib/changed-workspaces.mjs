import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

// Inputs shared by local verification and the CI entry points.
const globalFiles = new Set([
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.npmrc',
  'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts',
])
const globalPrefixes = [
  '.github/workflows/', 'scripts/', '.agents/skills/', '.agents/factory/', '.agents/personas/',
]

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function output(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' })
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

function filters(names) {
  return [...names].sort().flatMap((name) => ['--filter', name])
}

export function runChangedWorkspaces(script) {
  const baseRef = process.env[`${script.toUpperCase()}_BASE_REF`] || process.env.GITHUB_BASE_REF || 'main'
  const base = baseRef.startsWith('origin/') ? baseRef : `origin/${baseRef}`
  const concurrency = process.env.WORKSPACE_CONCURRENCY || '4'
  const label = `${script}-changed`
  const root = output('git', ['rev-parse', '--show-toplevel']).trim()
  process.chdir(root)

  try {
    output('git', ['rev-parse', '--verify', base])
  } catch {
    const branch = baseRef.replace(/^origin\//, '')
    run('git', ['fetch', '--no-tags', '--depth=1', 'origin', `${branch}:refs/remotes/origin/${branch}`])
  }

  // Include the PR diff and work in progress. NUL separation preserves unusual
  // filenames; disabling rename detection keeps both source and target owners.
  const changedFiles = new Set([
    ...output('git', ['diff', '--name-only', '-z', '--no-renames', `${base}...HEAD`]).split('\0'),
    ...output('git', ['diff', '--name-only', '-z', '--no-renames', 'HEAD']).split('\0'),
    ...output('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))

  if ([...changedFiles].some((file) => globalFiles.has(file) || globalPrefixes.some((prefix) => file.startsWith(prefix)))) {
    console.log(`${label}: global verification input changed; running full ${script}`)
    run('pnpm', ['run', script])
    return
  }

  const workspaces = JSON.parse(output('pnpm', ['-r', 'list', '--depth', '-1', '--json']))
    .filter((workspace) => workspace.name && workspace.path !== root)
    .map((workspace) => ({
      name: workspace.name,
      rel: relative(root, workspace.path).replaceAll('\\', '/'),
      manifest: JSON.parse(readFileSync(`${workspace.path}/package.json`, 'utf8')),
    }))
  const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]))
  const packageByRel = [...workspaces].sort((a, b) => b.rel.length - a.rel.length)
  const changedNames = new Set()
  for (const file of changedFiles) {
    const owner = packageByRel.find((workspace) => file === workspace.rel || file.startsWith(`${workspace.rel}/`))
    if (owner) changedNames.add(owner.name)
  }
  if (changedNames.size === 0) {
    console.log(`${label}: no workspace package changes since ${base} (including local edits); skipping`)
    return
  }

  const depsByName = new Map()
  const dependentsByName = new Map(workspaces.map((workspace) => [workspace.name, new Set()]))
  for (const workspace of workspaces) {
    const dependencies = new Set()
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(workspace.manifest[section] ?? {})) {
        if (workspaceByName.has(name)) dependencies.add(name)
      }
    }
    depsByName.set(workspace.name, dependencies)
    for (const name of dependencies) dependentsByName.get(name).add(workspace.name)
  }

  const checkNames = closure(changedNames, dependentsByName)
  const buildNames = new Set([...closure(checkNames, depsByName)].filter((name) => {
    const workspace = workspaceByName.get(name)
    return !workspace.rel.startsWith('apps/') && workspace.manifest.scripts?.build
  }))
  const scriptNames = new Set([...checkNames].filter((name) => workspaceByName.get(name).manifest.scripts?.[script]))

  console.log(`${label}: changed=${[...changedNames].sort().join(', ')}`)
  console.log(`${label}: checking changed packages + dependents=${[...checkNames].sort().join(', ')}`)
  console.log(`${label}: ${script}-capable workspaces=${[...scriptNames].sort().join(', ') || '(none)'}`)
  console.log(`${label}: prebuilding package/plugin dependencies=${[...buildNames].sort().join(', ') || '(none)'}`)
  if (scriptNames.size === 0) {
    console.log(`${label}: no affected workspaces with ${script} scripts; skipping`)
    return
  }
  if (buildNames.size > 0) run('pnpm', ['-r', ...filters(buildNames), `--workspace-concurrency=${concurrency}`, 'run', 'build'])
  run('pnpm', ['-r', ...filters(scriptNames), `--workspace-concurrency=${concurrency}`, 'run', script])
}
