#!/usr/bin/env node
// Factory Hub launcher: provision epic worktrees, then register them in one host.
import { execFile, spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const exec = promisify(execFile)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
export const REPOSITORY_ROOT = process.env.BORING_FACTORY_WORKSPACE_ROOT
  ? resolve(process.env.BORING_FACTORY_WORKSPACE_ROOT)
  : (await exec('git', ['-C', SCRIPT_DIR, 'rev-parse', '--show-toplevel'])).stdout.trim()
const STATE_ROOT = resolve(process.env.BORING_FACTORY_STATE_ROOT || resolve(APP_ROOT, '.factory-state'))
const API_PORT = process.env.AGENT_API_PORT || '5230'
const UI_PORT = process.env.PORT || '5220'
const API_ROOT = process.env.BORING_FACTORY_API_ROOT || `http://127.0.0.1:${API_PORT}`

function slugify(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'epic'
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; index += 1 } else flags[key] = true
  }
  return { positional, flags }
}

function parseModels(value) {
  if (!value || value === true) return undefined
  const models = {}
  for (const pair of value.split(',')) {
    const [rawSeat, ...rest] = pair.split('=')
    const model = rest.join('=').trim()
    const seat = rawSeat.trim() === 'orch' ? 'orchestrator' : rawSeat.trim()
    if (['orchestrator', 'worker', 'reviewer'].includes(seat) && model) models[seat] = model
  }
  return Object.keys(models).length > 0 ? models : undefined
}

async function directoryExists(path) {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    })
  } catch (error) {
    throw new Error(`Factory Hub is not reachable at ${API_ROOT}. Start it with \`pnpm --filter factory-playground epic hub up\` or \`pnpm --filter factory-playground dev\`. (${error.message})`)
  }
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : undefined } catch { body = text }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  return body
}

async function waitForHub(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await request('/api/v1/workspace/meta') } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500))
  }
  throw new Error(`timed out waiting for Factory Hub at ${API_ROOT}`)
}

function assertExpectedHub(meta) {
  if (meta?.workspaceId !== 'factory-hub') throw new Error(`${API_ROOT} is not a Factory Hub (workspaceId=${meta?.workspaceId ?? 'missing'})`)
  if (typeof meta.workspaceRoot !== 'string') throw new Error(`Factory Hub at ${API_ROOT} did not report a workspaceRoot`)
  if (resolve(meta.workspaceRoot) !== REPOSITORY_ROOT) {
    throw new Error(`Factory Hub at ${API_ROOT} serves ${meta.workspaceRoot}, not ${REPOSITORY_ROOT}`)
  }
  return meta
}

async function cmdHubUp() {
  let existing
  try {
    existing = await request('/api/v1/workspace/meta')
  } catch (error) {
    if (!String(error.message).startsWith('Factory Hub is not reachable')) throw error
  }
  if (existing) {
    const meta = assertExpectedHub(existing)
    console.log(`[factory-hub] already running at ${API_ROOT} (${meta.workspaceId})`)
    return
  }
  const logsRoot = resolve(STATE_ROOT, 'logs')
  await mkdir(logsRoot, { recursive: true })
  const logPath = resolve(logsRoot, 'hub.log')
  const log = openSync(logPath, 'a')
  const child = spawn('pnpm', ['--filter', 'factory-playground', 'dev'], {
    cwd: REPOSITORY_ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      BORING_FACTORY_WORKSPACE_ROOT: REPOSITORY_ROOT,
      BORING_FACTORY_STATE_ROOT: STATE_ROOT,
      BORING_AGENT_SESSION_ROOT: process.env.BORING_AGENT_SESSION_ROOT || resolve(STATE_ROOT, 'sessions'),
      AGENT_API_PORT: API_PORT,
      PORT: UI_PORT,
    },
  })
  child.unref()
  const meta = assertExpectedHub(await waitForHub())
  console.log(`[factory-hub] running ${meta.projectName} at http://127.0.0.1:${UI_PORT}/ (API ${API_ROOT}, pid ${child.pid}, log ${logPath})`)
}

async function resolveBaseRef(flags) {
  if (flags.pr !== undefined) {
    const number = String(flags.pr)
    if (!/^\d+$/.test(number)) throw new Error('--pr must be a pull request number')
    const ref = `refs/remotes/origin/factory-pr-${number}`
    await exec('git', ['fetch', 'origin', `pull/${number}/head:${ref}`], { cwd: REPOSITORY_ROOT })
    return ref
  }
  if (typeof flags.branch === 'string') {
    try {
      await exec('git', ['rev-parse', '--verify', flags.branch], { cwd: REPOSITORY_ROOT })
      return flags.branch
    } catch {
      await exec('git', ['rev-parse', '--verify', `origin/${flags.branch}`], { cwd: REPOSITORY_ROOT })
      return `origin/${flags.branch}`
    }
  }
  return 'origin/main'
}

async function provisionWorktree(epicKey, baseRef) {
  const branch = `epic/${epicKey}`
  const worktree = resolve(REPOSITORY_ROOT, '.worktrees', `epic-${epicKey}`)
  if (!(await directoryExists(worktree))) {
    await mkdir(resolve(worktree, '..'), { recursive: true })
    const branchExists = await exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: REPOSITORY_ROOT })
      .then(() => true, () => false)
    if (branchExists) await exec('git', ['worktree', 'add', worktree, branch], { cwd: REPOSITORY_ROOT })
    else await exec('git', ['worktree', 'add', '-b', branch, worktree, baseRef], { cwd: REPOSITORY_ROOT })
  }
  const actualBranch = (await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree })).stdout.trim()
  if (actualBranch !== branch) throw new Error(`${worktree} is on ${actualBranch}, expected ${branch}`)

  console.log(`[factory-epic] provisioning dependencies in ${worktree}`)
  await exec('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: worktree, maxBuffer: 16 * 1024 * 1024 })
  await exec('pnpm', ['build'], { cwd: worktree, maxBuffer: 16 * 1024 * 1024 })
  return worktree
}

async function cmdUp(flags) {
  if (flags.repo !== undefined) throw new Error('--repo is reserved for the future multi-repository registry; this hub currently accepts its canonical repository only')
  if (flags.provider !== undefined) throw new Error('--provider is a Factory Hub setting; set BORING_FACTORY_SANDBOX_PROVIDER before `hub up`')
  const featureName = typeof flags.feature === 'string' ? flags.feature.trim() : ''
  if (!featureName) throw new Error('--feature "<Feature Name>" is required')
  const epicKey = typeof flags.key === 'string' ? flags.key.trim() : slugify(featureName)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(epicKey)) throw new Error('--key must be a lowercase slug (letters, numbers, and single hyphens)')
  assertExpectedHub(await request('/api/v1/workspace/meta'))
  await exec('git', ['fetch', 'origin'], { cwd: REPOSITORY_ROOT })
  const baseRef = await resolveBaseRef(flags)
  const branch = `epic/${epicKey}`
  const worktree = await provisionWorktree(epicKey, baseRef)
  const entry = await request('/api/v1/factory/epics', {
    method: 'POST',
    body: JSON.stringify({
      epicKey,
      featureName,
      worktree,
      branch,
      ...(typeof flags.request === 'string' ? { requestFile: flags.request } : {}),
      ...(parseModels(flags.models) ? { models: parseModels(flags.models) } : {}),
      start: flags.start !== 'false',
    }),
  })
  console.log(`[factory-epic] registered ${entry.epicKey} (${entry.branch}) in Factory Hub`)
  console.log(`[factory-epic] Orchestrator: ${entry.orchestratorSessionId}; UI: http://127.0.0.1:${UI_PORT}/`)
  if (entry.kickoff?.status === 'failed') {
    console.warn(`[factory-epic] kickoff was not accepted (${entry.kickoff.message}); the registered Orchestrator session is ready to retry`)
  }
}

async function cmdList() {
  assertExpectedHub(await request('/api/v1/workspace/meta'))
  const entries = await request('/api/v1/factory/epics')
  if (entries.length === 0) { console.log('No registered epics.'); return }
  for (const entry of entries) {
    const gate = entry.pendingQuestion ? ' gate=pending' : ''
    console.log(`${entry.epicKey}\t${entry.status}\t${entry.headSha?.slice(0, 8) || 'no-head'}\torch=${entry.orchestratorStatus || 'none'}${gate}\tbeads=${entry.beads.open}/${entry.beads.closed} open/closed`)
    console.log(`  ${entry.featureName} · ${entry.branch} · ${entry.worktree}`)
  }
}

async function cmdDown(epicKey) {
  if (!epicKey) throw new Error('usage: down <epic-key>')
  assertExpectedHub(await request('/api/v1/workspace/meta'))
  const entry = await request(`/api/v1/factory/epics/${encodeURIComponent(epicKey)}/close`, { method: 'POST', body: '{}' })
  console.log(`[factory-epic] marked '${entry.epicKey}' closed; worktree kept at ${entry.worktree}`)
}

export async function cmdAdopt(epicKey, flags) {
  if (!epicKey) throw new Error('usage: adopt <epic-key> --session <id> --transcript <absolute-path>')
  if (typeof flags.session !== 'string' || !flags.session.trim()) throw new Error('--session <id> is required')
  if (typeof flags.transcript !== 'string' || !flags.transcript.trim()) throw new Error('--transcript <absolute-path> is required')
  if (!isAbsolute(flags.transcript)) throw new Error('--transcript must be an absolute path')
  assertExpectedHub(await request('/api/v1/workspace/meta'))
  const entry = await request(`/api/v1/factory/epics/${encodeURIComponent(epicKey)}/adopt`, {
    method: 'POST',
    body: JSON.stringify({ orchestratorSessionId: flags.session.trim(), transcriptPath: flags.transcript }),
  })
  console.log(`[factory-epic] adopted Orchestrator ${entry.orchestratorSessionId} for '${entry.epicKey}'`)
}

async function cmdIntake() {
  const { stdout } = await exec('gh', ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,headRefName,isDraft'], { cwd: REPOSITORY_ROOT })
  const pulls = JSON.parse(stdout)
  if (pulls.length === 0) { console.log('No open PRs found.'); return }
  for (const pull of pulls) {
    console.log(`# #${pull.number}${pull.isDraft ? ' [draft]' : ''} ${pull.title} (${pull.headRefName})`)
    console.log(`pnpm --filter factory-playground epic up --feature ${JSON.stringify(pull.title)} --pr ${pull.number}\n`)
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseArgs(rest)
  if (command === 'hub' && positional[0] === 'up') return await cmdHubUp()
  if (command === 'up') return await cmdUp(flags)
  if (command === 'list') return await cmdList()
  if (command === 'adopt') return await cmdAdopt(positional[0], flags)
  if (command === 'down') return await cmdDown(positional[0])
  if (command === 'intake') return await cmdIntake()
  console.log('Usage: factory-epic.mjs hub up | up --feature <name> [--key <slug>] [--pr <n>|--branch <name>] [--request <path>] [--models orch=...,worker=...,reviewer=...] [--start false] | list | adopt <key> --session <id> --transcript <absolute-path> | down <key> | intake')
  if (command) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[factory-epic] ${error.stack || error.message}`)
    process.exitCode = 1
  })
}
