// Live Factory epic acceptance: one epic, one shared worktree. The Orchestrator plans the Bead graph,
// supervises with /loop and dispatches one Worker; the Worker pulls, commits, sandbox-tests the exact SHA,
// obtains a fresh_review and hands off on the Bead. Never merges.
//
// Usage (API already running on 127.0.0.1:5230 against EPIC_WT with BORING_FACTORY_EPIC_KEY=EPIC_KEY):
//   EPIC_WT=/abs/path/to/epic-worktree EPIC_KEY=<epic key> node scripts/live-epic-acceptance.mjs
// Requires model credentials on the API process and the `br` CLI on PATH.
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
const exec = promisify(execFile)
const EPIC_WT = process.env.EPIC_WT
if (!EPIC_WT) throw new Error('EPIC_WT is required')
const EPIC = process.env.EPIC_KEY
if (!EPIC) throw new Error('EPIC_KEY is required')
const base = 'http://127.0.0.1:5230/api/v1/agents'
const headers = { 'x-boring-workspace-id': 'factory-playground', 'content-type': 'application/json' }
const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${t.slice(0, 500)}`); return t ? JSON.parse(t) : undefined }
const create = async (type, title) => (await call('POST', `/${type}/sessions`, { requestId: randomUUID(), title })).sessionId
const prompt = async (type, sid, content) => { for (let i = 0; i < 40; i++) { try { return await call('POST', `/${type}/sessions/${sid}/prompt`, { requestId: randomUUID(), clientNonce: randomUUID(), content, requireIdle: true }) } catch (e) { if (!String(e.message).includes('not idle')) throw e; await new Promise(r => setTimeout(r, 3000)) } } throw new Error('session never idle for prompt') }
const state = async (type, sid) => call('GET', `/${type}/sessions/${sid}/state`)
const wait = async (type, sid, turns, ms = 1500000) => { const end = Date.now() + ms; let last = ''; while (Date.now() < end) { const s = await state(type, sid); const tag = `${s.state.status}/${s.summary.turnCount}`; if (tag !== last) { console.log(`  [${type}] ${tag}`); last = tag }; if (s.summary.turnCount >= turns && s.state.status === 'idle') return s; await new Promise(r => setTimeout(r, 3000)) } throw new Error(`timeout ${type}`) }
const text = s => s.state.messages.filter(m => m.role === 'assistant').flatMap(m => m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n')
const lastText = s => { const a = s.state.messages.filter(m => m.role === 'assistant'); const m = a.at(-1); return (m?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n') }
const toolNames = s => s.state.messages.flatMap(m => m.parts || []).filter(p => p.type && p.type !== 'text').map(p => `${p.type}:${p.name ?? p.toolName ?? ''}`)
const git = async (args) => (await exec('git', args, { cwd: EPIC_WT })).stdout.trim()
const br = async (args) => { const out = JSON.parse((await exec('br', [...args, '--json', '--no-auto-flush'], { cwd: EPIC_WT })).stdout); return Array.isArray(out) ? out : out.issues ?? [] }
const loop = (sid, args) => call('POST', '/boring-orchestrator/commands/execute', { requestId: randomUUID(), sessionId: sid, name: 'loop', args })

const baseSha = await git(['rev-parse', 'HEAD'])
console.log('epic worktree base', baseSha, 'epic', EPIC)
let osid, loopOn = false
const receipt = { epic: EPIC, baseSha }
try {
  osid = await create('boring-orchestrator', `Epic ${EPIC}: Orchestrator`)
  receipt.orchestratorSessionId = osid
  console.log('orchestrator', osid)
  await prompt('boring-orchestrator', osid, [
    `Host context: your session id is ${osid}.\nOwner request for epic ${EPIC} (shared worktree = this workspace, branch ${await git(['rev-parse', '--abbrev-ref', 'HEAD'])}).`,
    'Feature: in apps/factory-playground/src/fixtures/demo-repo, add an exported farewell(name) function to src/greeting.js returning exactly `Goodbye, ${name}.` (comma, trailing period), add a focused node:test case in test/greeting.test.js, and document import + usage in that fixture README.md. Proof: `npm test` inside the fixture directory.',
    'The owner approves this bounded plan now (plan gate passed). Materialize the smallest dependency-correct Bead graph with real br commands, then report only durable graph facts: Bead ids, labels, ready set.',
    'Do not implement, claim, assign a Bead to a Worker, dispatch yet, or merge.',
  ].join('\n'))
  const planned = await wait('boring-orchestrator', osid, 1)
  console.log('\n=== ORCHESTRATOR PLAN ===\n' + lastText(planned))
  receipt.orchestratorModel = planned.state.currentModel
  const ready = await br(['ready', '--label', `epic:${EPIC}`])
  receipt.readyAfterPlan = ready.map(b => ({ id: b.id, labels: b.labels, title: b.title }))
  console.log('ready(epic):', JSON.stringify(receipt.readyAfterPlan))
  if (!ready.length) throw new Error('no ready epic-labelled beads after plan')

  await loop(osid, `120s Supervise epic ${EPIC} only: inspect br (label epic:${EPIC}) and git end-states of the shared worktree. Verify pull-based claims, commits on the epic branch, exact-SHA sandbox test evidence, fresh_review provenance, handoff completeness, no merge. Report durable end-state facts only; never implement or assign Beads.`)
  loopOn = true
  console.log('loop started')
  await wait('boring-orchestrator', osid, 2)

  await prompt('boring-orchestrator', osid, `Dispatch exactly one Worker now with the dispatch_worker tool. The brief must name epic ${EPIC}, the shared worktree, the pull protocol (br ready --label epic:${EPIC} --unassigned, claim one with --claim --actor <session id>), implement + stage only intended files + commit on the epic branch, exact-SHA dedicated sandbox test via the sandbox tools, adversarial fresh_review of that SHA, then a complete handoff recorded in the Bead (SHA, test evidence, review provenance) and git push of the epic branch. It must never merge or close its own Bead. Do not name a specific Bead. When the tool returns, report the Worker's final answer and what the br/git end-states now show.`)
  let dispatched
  for (;;) { const ws = (await call('GET', '/boring-worker/sessions')).sessions ?? []; const mine = ws.filter(w => (w.title || '').includes(osid.slice(0, 8))); if (mine.length && mine.every(w => w.status === 'idle' && w.turnCount >= 1)) break; await new Promise(r => setTimeout(r, 5000)) }
  console.log('worker session(s) finished')
  dispatched = await wait('boring-orchestrator', osid, 2)
  console.log('\n=== ORCHESTRATOR AFTER DISPATCH ===\n' + lastText(dispatched))
  console.log('orchestrator tool parts:', JSON.stringify(toolNames(dispatched).slice(-12)))

  await loop(osid, 'stop'); loopOn = false
  const supervised = await wait('boring-orchestrator', osid, 3, 600000).catch(() => dispatched)
  console.log('\n=== ORCHESTRATOR SUPERVISION (last) ===\n' + lastText(supervised))

  const workers = (await call('GET', '/boring-worker/sessions')).sessions ?? []
  const reviewers = (await call('GET', '/boring-reviewer/sessions')).sessions ?? []
  receipt.workerSessions = workers.map(s => s.ref?.sessionId ?? s.sessionId)
  receipt.reviewerSessions = reviewers.map(s => s.ref?.sessionId ?? s.sessionId)
  for (const w of workers.slice(0, 3)) { const s = await state('boring-worker', w.ref?.sessionId ?? w.sessionId); console.log(`\n=== WORKER ${w.ref?.sessionId ?? w.sessionId} (${s.state.currentModel?.id ?? ''}) ===\n` + lastText(s)); console.log('worker tool parts:', JSON.stringify(toolNames(s))) }
  for (const r of reviewers.slice(0, 3)) { const s = await state('boring-reviewer', r.ref?.sessionId ?? r.sessionId); console.log(`\n=== REVIEWER ${r.ref?.sessionId ?? r.sessionId} ===\n` + lastText(s).slice(0, 3000)) }

  receipt.headSha = await git(['rev-parse', 'HEAD'])
  receipt.log = await git(['log', '--oneline', `${baseSha}..HEAD`])
  receipt.gitStatus = await git(['status', '--short'])
  receipt.remoteBranch = await git(['ls-remote', '--heads', 'origin', await git(['rev-parse', '--abbrev-ref', 'HEAD'])]).catch(() => 'n/a')
  receipt.graph = (await br(['list', '--label', `epic:${EPIC}`])).map(b => ({ id: b.id, status: b.status, assignee: b.assignee, labels: b.labels, title: b.title, notes: (b.notes || '').slice(0, 600) }))
  receipt.fixtureTest = await exec('npm', ['test'], { cwd: EPIC_WT + '/apps/factory-playground/src/fixtures/demo-repo' }).then(r => 'pass').catch(e => 'FAIL: ' + (e.stdout || '').slice(-300))
  const out = process.env.RECEIPT_PATH ?? resolve(EPIC_WT, 'apps/factory-playground/workspace/factory-runs', `live-${EPIC}.json`)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(receipt, null, 2))
  console.log('receipt:', out)
  console.log('\n=== RECEIPT ===\n' + JSON.stringify(receipt, null, 2))
} finally {
  if (loopOn && osid) await loop(osid, 'stop').catch(() => {})
}
