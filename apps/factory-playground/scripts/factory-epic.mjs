#!/usr/bin/env node
// factory-epic.mjs — launch one Factory instance per work thread (PR / branch of this
// repo, or an epic in another repository), each with its own Inbox/Agents UI.
//
// Usage:
//   node scripts/factory-epic.mjs up --feature "<Feature Name>" (--pr <n> | --branch <name> | --repo <url-or-path> [--base <ref>]) [--provider vercel|local-simulation] [--models orch=...,worker=...,reviewer=...]
//   node scripts/factory-epic.mjs list
//   node scripts/factory-epic.mjs down <epic-key> [--keep-worktree]
//   node scripts/factory-epic.mjs intake
//
// Run from apps/factory-playground/ (or from anywhere via `pnpm --filter factory-playground epic ...`).
import { execFile, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { openSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIR, '..')
const STATE_ROOT = resolve(APP_ROOT, '.factory-state')
const REGISTRY_PATH = resolve(STATE_ROOT, 'epics.json')

// This repo's own toplevel (the checkout apps/factory-playground lives in). New
// worktrees for this repo's own branches/PRs, and clones of other repos, both
// live under `<REPO_ROOT>/.worktrees/` per AGENTS.md's worktree rule.
const REPO_ROOT = (await exec('git', ['-C', SCRIPT_DIR, 'rev-parse', '--show-toplevel'])).stdout.trim()

const RESERVED_API_PORTS = new Set([5230])
const RESERVED_UI_PORTS = new Set([5220])

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'epic'
}

function titleCaseWords(words) {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Best-effort 2-4 word Title Case feature name derived from a PR/branch title, stripping a leading [bracket]/prefix. */
function deriveFeatureNameFromTitle(rawTitle) {
  let stripped = rawTitle.trim()
  // Repeatedly strip leading [bracket] groups, bare #issue refs, and a
  // conventional-commit prefix (feat:, fix(scope):, ...).
  for (let i = 0; i < 6; i++) {
    const before = stripped
    stripped = stripped
      .replace(/^\[[^\]]*\]\s*/, '')
      .replace(/^#\d+\s*/, '')
      .replace(/^(feat|fix|chore|docs|refactor|test|perf)(\([^)]*\))?:\s*/i, '')
      .trim()
    if (stripped === before) break
  }
  const words = stripped.split(/\s+/).filter(Boolean).slice(0, 4)
  const minWords = words.length >= 2 ? words : stripped.split(/\s+/).filter(Boolean).slice(0, 2)
  return titleCaseWords(minWords.length > 0 ? minWords : ['Untitled', 'Work'])
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonFileAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, path)
}

async function readRegistry() {
  return readJsonFile(REGISTRY_PATH, { epics: {} })
}

async function writeRegistry(registry) {
  await writeJsonFileAtomic(REGISTRY_PATH, registry)
}

/** True if a TCP listener could bind 127.0.0.1:port right now (i.e. the port is free). */
function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const server = createServer()
    server.once('error', () => resolvePromise(false))
    server.once('listening', () => server.close(() => resolvePromise(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** True if something is actively listening on 127.0.0.1:port. */
async function isPortLive(port) {
  return !(await isPortFree(port))
}

async function pickFreePorts(registry) {
  const usedApi = new Set([...RESERVED_API_PORTS, ...Object.values(registry.epics).map((e) => e.apiPort)])
  const usedUi = new Set([...RESERVED_UI_PORTS, ...Object.values(registry.epics).map((e) => e.uiPort)])
  for (let k = 1; k < 500; k++) {
    const apiPort = 5230 + 2 * k
    const uiPort = 5220 + 2 * k
    if (usedApi.has(apiPort) || usedUi.has(uiPort)) continue
    // eslint-disable-next-line no-await-in-loop
    if (!(await isPortFree(apiPort)) || !(await isPortFree(uiPort))) continue
    return { apiPort, uiPort }
  }
  throw new Error('could not find a free API/UI port pair after 500 attempts')
}

/** `${VAR:-$(vault kv get -field=<field> <path>)}` in JS: env wins; vault is a best-effort, non-fatal fallback. */
function resolveSecret(envValue, vaultPath, vaultField) {
  const fromEnv = envValue?.trim()
  if (fromEnv) return fromEnv
  try {
    return execFileSync('vault', ['kv', 'get', '-field', vaultField, vaultPath], { encoding: 'utf8' }).trim() || undefined
  } catch {
    return undefined
  }
}

function resolveGhAuthToken() {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || undefined
  } catch {
    return undefined
  }
}

async function tailscaleIpv4() {
  try {
    const { stdout } = await exec('tailscale', ['ip', '-4'])
    return stdout.trim().split('\n')[0] || undefined
  } catch {
    return undefined
  }
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function parseModels(modelsFlag) {
  const result = {}
  if (!modelsFlag || modelsFlag === true) return result
  for (const pair of modelsFlag.split(',')) {
    const [key, ...rest] = pair.split('=')
    const value = rest.join('=').trim()
    if (!key || !value) continue
    if (key.trim() === 'orch') result.orchestrator = value
    else if (key.trim() === 'worker') result.worker = value
    else if (key.trim() === 'reviewer') result.reviewer = value
  }
  return result
}

async function ensureGitIdentity(cwd) {
  const hasIdentity = async (key) => {
    try {
      const { stdout } = await exec('git', ['config', key], { cwd })
      return stdout.trim().length > 0
    } catch {
      return false
    }
  }
  if (await hasIdentity('user.email') && await hasIdentity('user.name')) return
  const name = resolveSecret(undefined, 'secret/agent/boringdata-agent', 'username')
  const email = resolveSecret(undefined, 'secret/agent/boringdata-agent', 'email')
  if (name) await exec('git', ['config', 'user.name', name], { cwd })
  if (email) await exec('git', ['config', 'user.email', email], { cwd })
}

async function ensureBeadsInit(cwd) {
  const beadsDir = resolve(cwd, '.beads')
  const exists = await readJsonFile(resolve(beadsDir, 'config.yaml'), null).then(() => true).catch(() => false)
  if (exists) return
  try {
    await exec('br', ['init', '--no-auto-flush'], { cwd })
  } catch (error) {
    console.warn(`[factory-epic] warning: 'br init --no-auto-flush' failed in ${cwd}: ${error.message}`)
  }
}

async function dirExists(path) {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// up
// ---------------------------------------------------------------------------

async function resolveWorktreeForThisRepo({ pr, branch, slug }) {
  await exec('git', ['-C', REPO_ROOT, 'fetch', 'origin'])
  let branchName = branch
  if (pr) {
    const { stdout } = await exec('gh', ['pr', 'view', String(pr), '--json', 'headRefName,headRepository'], { cwd: REPO_ROOT })
    const info = JSON.parse(stdout)
    branchName = info.headRefName
    console.log(`[factory-epic] PR #${pr} head branch: ${branchName} (repo: ${info.headRepository?.name ?? 'origin'})`)
  }
  const worktreePath = resolve(REPO_ROOT, '.worktrees', `epic-${slug}`)
  if (await dirExists(worktreePath)) {
    console.log(`[factory-epic] reusing existing worktree ${worktreePath}`)
    return { workspaceRoot: worktreePath, branch: branchName, worktreeGitRoot: REPO_ROOT, repoUrl: undefined }
  }
  try {
    await exec('git', ['-C', REPO_ROOT, 'worktree', 'add', worktreePath, branchName])
  } catch (error) {
    const message = String(error.stderr || error.message || '')
    if (message.includes('already checked out') || message.includes('already used by worktree')) {
      console.warn(`[factory-epic] branch '${branchName}' is already checked out elsewhere (e.g. this is your current worktree's own branch); creating a detached worktree at its HEAD instead. Commits made in the new worktree will need an explicit push to move '${branchName}'.`)
      await exec('git', ['-C', REPO_ROOT, 'worktree', 'add', '--detach', worktreePath, branchName])
    } else {
      throw error
    }
  }
  return { workspaceRoot: worktreePath, branch: branchName, worktreeGitRoot: REPO_ROOT, repoUrl: undefined }
}

function repoSlugFromUrl(repo) {
  const base = repo.replace(/\.git$/, '').replace(/\/$/, '')
  const last = base.split(/[/:]/).pop()
  return slugify(last || 'repo')
}

async function resolveWorktreeForExternalRepo({ repo, base, slug }) {
  const repoSlug = repoSlugFromUrl(repo)
  const mirrorPath = resolve(REPO_ROOT, '.worktrees', 'repos', repoSlug)
  const epicPath = resolve(REPO_ROOT, '.worktrees', 'repos', `${repoSlug}-${slug}`)

  if (!(await dirExists(mirrorPath))) {
    console.log(`[factory-epic] cloning ${repo} into ${mirrorPath}`)
    await mkdir(dirname(mirrorPath), { recursive: true })
    await exec('git', ['clone', repo, mirrorPath])
  } else {
    console.log(`[factory-epic] reusing existing clone ${mirrorPath} (fetching)`)
    await exec('git', ['-C', mirrorPath, 'fetch', 'origin']).catch((error) => {
      console.warn(`[factory-epic] warning: fetch in ${mirrorPath} failed: ${error.message}`)
    })
  }

  const baseRef = base || await (async () => {
    try {
      const { stdout } = await exec('git', ['-C', mirrorPath, 'symbolic-ref', 'refs/remotes/origin/HEAD'])
      return stdout.trim().replace('refs/remotes/origin/', '')
    } catch {
      return 'main'
    }
  })()

  const branchName = `epic/${slug}`
  if (await dirExists(epicPath)) {
    console.log(`[factory-epic] reusing existing epic worktree ${epicPath}`)
    return { workspaceRoot: epicPath, branch: branchName, worktreeGitRoot: mirrorPath, repoUrl: repo }
  }

  try {
    await exec('git', ['-C', mirrorPath, 'worktree', 'add', '-B', branchName, epicPath, `origin/${baseRef}`])
  } catch (error) {
    // Branch may already exist locally in the mirror from a prior partial run.
    await exec('git', ['-C', mirrorPath, 'worktree', 'add', epicPath, branchName])
  }
  try {
    await exec('git', ['-C', epicPath, 'push', '-u', 'origin', branchName])
  } catch (error) {
    console.warn(`[factory-epic] warning: could not push ${branchName} to origin yet (${error.message}). Push it manually before using the vercel provider.`)
  }
  return { workspaceRoot: epicPath, branch: branchName, worktreeGitRoot: mirrorPath, repoUrl: repo }
}

async function waitForMeta(apiPort, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/workspace/meta`)
      if (response.ok) return await response.json()
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`timed out waiting for http://127.0.0.1:${apiPort}/api/v1/workspace/meta`)
}

async function cmdUp(flags) {
  const feature = flags.feature
  if (!feature || feature === true) throw new Error('--feature "<Feature Name>" is required')
  const slug = slugify(feature)

  const modeCount = ['pr', 'branch', 'repo'].filter((k) => flags[k] !== undefined).length
  if (modeCount !== 1) throw new Error('exactly one of --pr, --branch, or --repo is required')

  let worktree
  if (flags.pr !== undefined) {
    worktree = await resolveWorktreeForThisRepo({ pr: flags.pr, slug })
  } else if (flags.branch !== undefined) {
    worktree = await resolveWorktreeForThisRepo({ branch: flags.branch, slug })
  } else {
    worktree = await resolveWorktreeForExternalRepo({ repo: flags.repo, base: typeof flags.base === 'string' ? flags.base : undefined, slug })
  }

  await ensureGitIdentity(worktree.workspaceRoot)
  await ensureBeadsInit(worktree.workspaceRoot)

  const registry = await readRegistry()
  if (registry.epics[slug]) {
    throw new Error(`epic '${slug}' is already registered (workspaceRoot: ${registry.epics[slug].workspaceRoot}). Run 'down ${slug}' first, or pick a different --feature.`)
  }
  const { apiPort, uiPort } = await pickFreePorts(registry)

  const provider = flags.provider === 'vercel' ? 'vercel' : 'local-simulation'
  const models = parseModels(flags.models)

  const epicStateRoot = resolve(STATE_ROOT, 'epics', slug)
  const logsDir = resolve(epicStateRoot, 'logs')
  await mkdir(logsDir, { recursive: true })

  const openaiKey = resolveSecret(process.env.OPENAI_API_KEY, 'secret/openai', 'api_key')
  const anthropicKey = resolveSecret(process.env.ANTHROPIC_API_KEY, 'secret/agent/anthropic', 'api_key')

  const env = {
    ...process.env,
    ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
    ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
    BORING_FACTORY_WORKSPACE_ROOT: worktree.workspaceRoot,
    BORING_FACTORY_EPIC_KEY: slug,
    BORING_FACTORY_FEATURE_NAME: feature,
    BORING_FACTORY_STATE_ROOT: epicStateRoot,
    BORING_AGENT_SESSION_ROOT: resolve(epicStateRoot, 'sessions'),
    BORING_FACTORY_SANDBOX_PROVIDER: provider,
    BORING_SANDBOX_TELEMETRY_SALT: randomUUID(),
    AGENT_API_PORT: String(apiPort),
    PORT: String(uiPort),
    ...(models.orchestrator ? { BORING_FACTORY_ORCHESTRATOR_MODEL: models.orchestrator } : {}),
    ...(models.worker ? { BORING_FACTORY_WORKER_MODEL: models.worker } : {}),
    ...(models.reviewer ? { BORING_FACTORY_REVIEWER_MODEL: models.reviewer } : {}),
  }
  if (provider === 'vercel' && !env.BORING_FACTORY_GIT_TOKEN) {
    const ghToken = resolveGhAuthToken()
    if (ghToken) env.BORING_FACTORY_GIT_TOKEN = ghToken
  }

  const hostLog = resolve(logsDir, 'host.log')
  const hostFd = openSync(hostLog, 'a')
  const host = spawn('pnpm', ['exec', 'tsx', 'scripts/factory-host.mts'], {
    cwd: APP_ROOT,
    env,
    detached: true,
    stdio: ['ignore', hostFd, hostFd],
  })
  host.unref()

  const viteLog = resolve(logsDir, 'vite.log')
  const viteFd = openSync(viteLog, 'a')
  console.log(`[factory-epic] launching epic '${slug}' (feature: ${feature}) — API ${apiPort}, UI ${uiPort}`)
  console.log(`[factory-epic]   workspaceRoot: ${worktree.workspaceRoot}`)
  console.log(`[factory-epic]   host log: ${hostLog}`)
  console.log(`[factory-epic]   vite log: ${viteLog}`)
  const vite = spawn('pnpm', ['exec', 'vite', '--port', String(uiPort), '--host', '127.0.0.1'], {
    cwd: APP_ROOT,
    env: { ...env, BORING_FACTORY_VITE_FRONTEND_ONLY: '1' },
    detached: true,
    stdio: ['ignore', viteFd, viteFd],
  })
  vite.unref()

  let meta
  try {
    meta = await waitForMeta(apiPort)
  } catch (error) {
    console.error(`[factory-epic] ${error.message}`)
    for (const logPath of [hostLog, viteLog]) {
      console.error(`[factory-epic] tail of ${logPath}:`)
      try {
        const { stdout } = await exec('tail', ['-n', '60', logPath])
        console.error(stdout)
      } catch {
        // ignore
      }
    }
    throw error
  }

  registry.epics[slug] = {
    epicKey: slug,
    featureName: feature,
    workspaceRoot: worktree.workspaceRoot,
    branch: worktree.branch,
    repoUrl: worktree.repoUrl,
    worktreeGitRoot: worktree.worktreeGitRoot,
    apiPort,
    uiPort,
    provider,
    pids: [host.pid, vite.pid],
    startedAt: new Date().toISOString(),
    stateRoot: epicStateRoot,
  }
  await writeRegistry(registry)

  const tsIp = await tailscaleIpv4()
  console.log('')
  console.log(`[factory-epic] up: epic '${slug}' — ${meta.projectName ?? 'Boring Factory'} (${meta.defaultAgentTypeId})`)
  console.log(`[factory-epic]   UI:  http://127.0.0.1:${uiPort}/`)
  if (tsIp) console.log(`[factory-epic]   UI (tailscale): http://${tsIp}:${uiPort}/`)
  console.log(`[factory-epic]   API: http://127.0.0.1:${apiPort}/api/v1/workspace/meta`)
  console.log('[factory-epic] Next: open the UI, start on Boring Orchestrator, and paste your request.')
  console.log(`[factory-epic] Or drive it headlessly: EPIC_WT=${worktree.workspaceRoot} EPIC_KEY=${slug} API_PORT=${apiPort} node scripts/live-epic-acceptance.mjs`)
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

async function beadCounts(workspaceRoot, epicKey) {
  try {
    const { stdout } = await exec('br', ['list', '--label', `epic:${epicKey}`, '--json', '--no-auto-flush'], { cwd: workspaceRoot })
    const parsed = JSON.parse(stdout)
    const issues = Array.isArray(parsed) ? parsed : parsed.issues ?? []
    const counts = { open: 0, in_progress: 0, closed: 0, other: 0 }
    for (const issue of issues) {
      const status = issue.status ?? 'other'
      if (status in counts) counts[status]++
      else counts.other++
    }
    return counts
  } catch {
    return undefined
  }
}

async function cmdList() {
  const registry = await readRegistry()
  const entries = Object.values(registry.epics)
  if (entries.length === 0) {
    console.log('No registered epics. Run `node scripts/factory-epic.mjs up ...` or `intake` for candidates.')
    return
  }
  for (const entry of entries) {
    const live = await isPortLive(entry.apiPort)
    const counts = await beadCounts(entry.workspaceRoot, entry.epicKey)
    const countsStr = counts ? `open=${counts.open} in_progress=${counts.in_progress} closed=${counts.closed}` : 'beads: n/a'
    console.log(`${entry.epicKey}\t${live ? 'live' : 'down'}\tapi=${entry.apiPort} ui=${entry.uiPort}\t${countsStr}`)
    console.log(`  feature: ${entry.featureName}`)
    console.log(`  branch:  ${entry.branch}${entry.repoUrl ? ` (${entry.repoUrl})` : ''}`)
    console.log(`  root:    ${entry.workspaceRoot}`)
  }
}

// ---------------------------------------------------------------------------
// down
// ---------------------------------------------------------------------------

async function cmdDown(epicKey, flags) {
  if (!epicKey) throw new Error('usage: down <epic-key> [--keep-worktree]')
  const registry = await readRegistry()
  const entry = registry.epics[epicKey]
  if (!entry) throw new Error(`no registered epic '${epicKey}'`)

  for (const pid of entry.pids ?? []) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already dead
      }
    }
  }

  delete registry.epics[epicKey]
  await writeRegistry(registry)
  console.log(`[factory-epic] stopped epic '${epicKey}' and removed its registry entry.`)

  if (flags['keep-worktree']) {
    console.log(`[factory-epic] keeping worktree at ${entry.workspaceRoot} (--keep-worktree)`)
    return
  }
  try {
    await exec('git', ['-C', entry.worktreeGitRoot, 'worktree', 'remove', entry.workspaceRoot])
    console.log(`[factory-epic] removed worktree ${entry.workspaceRoot}`)
  } catch (error) {
    console.warn(`[factory-epic] could not remove worktree ${entry.workspaceRoot} automatically (${error.message}). Clean it up manually, or re-run with --keep-worktree next time.`)
  }
}

// ---------------------------------------------------------------------------
// intake
// ---------------------------------------------------------------------------

async function cmdIntake() {
  let prs
  try {
    const { stdout } = await exec('gh', ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,headRefName,updatedAt,isDraft'], { cwd: REPO_ROOT })
    prs = JSON.parse(stdout)
  } catch (error) {
    console.error(`[factory-epic] 'gh pr list' failed: ${error.message}`)
    return
  }
  if (prs.length === 0) {
    console.log('No open PRs found.')
    return
  }
  console.log(`Found ${prs.length} open PR(s). Candidate 'up' commands (never run automatically):\n`)
  for (const pr of prs) {
    const feature = deriveFeatureNameFromTitle(pr.title)
    const draftTag = pr.isDraft ? ' [draft]' : ''
    console.log(`# #${pr.number}${draftTag} ${pr.title} (${pr.headRefName}, updated ${pr.updatedAt})`)
    console.log(`node scripts/factory-epic.mjs up --feature "${feature}" --pr ${pr.number} --provider local-simulation\n`)
  }
}

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseArgs(rest)
  switch (command) {
    case 'up':
      await cmdUp(flags)
      break
    case 'list':
      await cmdList()
      break
    case 'down':
      await cmdDown(positional[0], flags)
      break
    case 'intake':
      await cmdIntake()
      break
    default:
      console.log('Usage: node scripts/factory-epic.mjs <up|list|down|intake> [...args]')
      if (command) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`[factory-epic] ${error.stack || error.message}`)
  process.exitCode = 1
})
