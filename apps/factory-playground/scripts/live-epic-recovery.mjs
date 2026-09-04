// Live Factory recovery acceptance: crash the API while a Worker is mid-Bead, restart, and verify the
// re-armed supervision recovers the stale claim and the epic still completes. Never merges.
//
// Usage: EPIC_WT=<epic worktree> EPIC_KEY=<key> LAUNCH=<path to launch script> node scripts/live-epic-recovery.mjs
// LAUNCH must (re)start the API on 127.0.0.1:5230 for EPIC_WT/EPIC_KEY and exit when it is up.
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
const exec = promisify(execFile)
const EPIC_WT = process.env.EPIC_WT; const EPIC = process.env.EPIC_KEY; const LAUNCH = process.env.LAUNCH
if (!EPIC_WT || !EPIC || !LAUNCH) throw new Error('EPIC_WT, EPIC_KEY and LAUNCH are required')
const STATE_ROOT = process.env.STATE_ROOT ?? resolve(EPIC_WT, '../issue-1508-factory-playground/apps/factory-playground/.factory-state')
const base = 'http://127.0.0.1:5230/api/v1/agents'
const headers = { 'x-boring-workspace-id': 'factory-playground', 'content-type': 'application/json' }
const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${t.slice(0, 500)}`); return t ? JSON.parse(t) : undefined }
const create = async (type, title) => (await call('POST', `/${type}/sessions`, { requestId: randomUUID(), title })).sessionId
// Session titles lead with the feature name, per docs/procedures/naming-conventions.md.
const featureName = async () => { const r = await fetch('http://127.0.0.1:5230/api/v1/workspace/meta', { headers }); if (!r.ok) throw new Error(`workspace/meta: ${r.status}`); const meta = await r.json(); if (!meta.featureName) throw new Error('workspace/meta did not report a featureName'); return meta.featureName }
const prompt = async (type, sid, content) => { for (let i = 0; i < 60; i++) { try { return await call('POST', `/${type}/sessions/${sid}/prompt`, { requestId: randomUUID(), clientNonce: randomUUID(), content, requireIdle: true }) } catch (e) { if (!String(e.message).includes('not idle')) throw e; await new Promise(r => setTimeout(r, 3000)) } } throw new Error('session never idle for prompt') }
const state = async (type, sid) => call('GET', `/${type}/sessions/${sid}/state`)
const sessions = async (type) => ((await call('GET', `/${type}/sessions`)).sessions ?? []).map(s => ({ sessionId: s.ref?.sessionId ?? s.sessionId, status: s.status, turnCount: s.turnCount, title: s.title }))
const wait = async (type, sid, turns, ms = 1500000) => { const end = Date.now() + ms; let last = ''; while (Date.now() < end) { const s = await state(type, sid); const tag = `${s.state.status}/${s.summary.turnCount}`; if (tag !== last) { console.log(`  [${type}] ${tag}`); last = tag }; if (s.summary.turnCount >= turns && s.state.status === 'idle') return s; await new Promise(r => setTimeout(r, 3000)) } throw new Error(`timeout ${type}`) }
const lastText = s => { const a = s.state.messages.filter(m => m.role === 'assistant'); const m = a.at(-1); return (m?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n') }
const toolNames = s => s.state.messages.flatMap(m => m.parts || []).filter(p => p.type === 'tool-call').map(p => p.name ?? p.toolName ?? '')
const git = async (args) => (await exec('git', args, { cwd: EPIC_WT })).stdout.trim()
const br = async (args) => { const out = JSON.parse((await exec('br', [...args, '--json', '--no-auto-flush'], { cwd: EPIC_WT })).stdout); return Array.isArray(out) ? out : out.issues ?? [] }
const apiPid = async () => { try { const { stdout } = await exec('ss', ['-ltnp']); const m = stdout.split('\n').find(l => l.includes('127.0.0.1:5230'))?.match(/pid=(\d+)/); return m ? Number(m[1]) : null } catch { return null } }
const relaunch = () => new Promise((res, rej) => { const p = spawn('bash', [LAUNCH], { env: { ...process.env, EPIC_WT, EPIC_KEY: EPIC }, stdio: 'inherit' }); p.on('exit', c => c === 0 ? res() : rej(new Error(`launch exit ${c}`))) })

const baseSha = await git(['rev-parse', 'HEAD'])
const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
const receipt = { epic: EPIC, baseSha, branch, phases: [] }
const phase = (name, data) => { console.log(`\n### ${name}`, JSON.stringify(data)); receipt.phases.push({ name, at: new Date().toISOString(), ...data }) }
let osid
try {
  osid = await create('boring-orchestrator', `[${await featureName()}] Orchestrator (recovery)`); receipt.orchestratorSessionId = osid
  await prompt('boring-orchestrator', osid, [
    `Host context: your session id is ${osid}.`,
    `Owner request for epic ${EPIC} (shared worktree = this workspace, branch ${branch}).`,
    'Feature: in apps/factory-playground/src/fixtures/demo-repo, add an exported farewell(name) function to src/greeting.js returning exactly `Goodbye, ${name}.` (comma, trailing period), add a focused node:test case in test/greeting.test.js, and document import + usage in that fixture README.md. Proof: `npm test` inside the fixture directory.',
    'The owner approves this bounded plan now (plan gate passed). Materialize the smallest dependency-correct Bead graph with real br commands, then start durable supervision with the supervise tool (op start, intervalMs 90000) whose prompt tells you to run factory_status and enforce the recovery rule, then report only durable graph facts. Do not implement, claim, dispatch yet, or merge.',
  ].join('\n'))
  const planned = await wait('boring-orchestrator', osid, 1)
  phase('plan', { text: lastText(planned).slice(0, 800), tools: toolNames(planned) })
  const ready = await br(['ready', '--label', `epic:${EPIC}`]); if (!ready.length) throw new Error('no ready epic bead')
  const supervision = JSON.parse(await readFile(resolve(STATE_ROOT, 'supervision.json'), 'utf8')).entries?.[osid]
  if (!supervision) throw new Error('supervision entry not persisted'); phase('supervision-armed', { intervalMs: supervision.intervalMs })

  await prompt('boring-orchestrator', osid, `Dispatch exactly one Worker now with dispatch_worker. Brief: epic ${EPIC}, shared worktree, pull protocol (br ready --label epic:${EPIC} --unassigned; claim one with --claim --actor <session id>), implement + stage only intended files + commit on the epic branch, exact-SHA dedicated sandbox test (verify .factory-sha or git rev-parse HEAD), adversarial fresh_review, complete handoff on the Bead, push the epic branch, never merge or close. Do not name a specific Bead.`)
  // Wait until a Worker exists and has claimed the Bead (assignee set), then crash the API.
  let claimed
  for (let i = 0; i < 200; i++) { const beads = await br(['list', '--label', `epic:${EPIC}`]); claimed = beads.find(b => b.assignee && b.status === 'in_progress'); if (claimed) break; await new Promise(r => setTimeout(r, 3000)) }
  if (!claimed) throw new Error('no claim observed'); const firstWorker = claimed.assignee
  await new Promise(r => setTimeout(r, 15000))
  const pid = await apiPid(); if (!pid) throw new Error('api pid not found')
  process.kill(pid, 'SIGKILL'); phase('crash', { pid, claimedBead: claimed.id, firstWorker, headAtCrash: await git(['rev-parse', 'HEAD']), dirty: await git(['status', '--short']) })
  await new Promise(r => setTimeout(r, 3000))
  await relaunch(); phase('restart', { rearmed: JSON.parse(await readFile(resolve(STATE_ROOT, 'supervision.json'), 'utf8')).entries?.[osid] ? 'yes' : 'no' })

  // Recovery: wait for a second Worker session (different id) to complete and the Bead to carry a handoff.
  let recovered
  const deadline = Date.now() + 1500000
  while (Date.now() < deadline) {
    const ws = await sessions('boring-worker'); const beads = await br(['list', '--label', `epic:${EPIC}`]); const bead = beads.find(b => b.id === claimed.id)
    const newWorker = ws.find(w => w.sessionId !== firstWorker && (w.title || '').includes(osid.slice(0, 8)))
    const head = await git(['rev-parse', 'HEAD'])
    if (newWorker && newWorker.status === 'idle' && newWorker.turnCount >= 1 && head !== baseSha) { recovered = { newWorker, bead: { id: bead?.id, status: bead?.status, assignee: bead?.assignee }, head }; break }
    await new Promise(r => setTimeout(r, 5000))
  }
  if (!recovered) throw new Error('recovery did not complete in time')
  phase('recovered', recovered)
  const orch = await wait('boring-orchestrator', osid, 2, 600000)
  phase('orchestrator-last', { text: lastText(orch).slice(0, 1500), tools: toolNames(orch).slice(-10) })
  const w = await state('boring-worker', recovered.newWorker.sessionId); phase('second-worker', { text: lastText(w).slice(0, 1500) })
  await call('POST', `/boring-orchestrator/sessions/${osid}/prompt`, { requestId: randomUUID(), clientNonce: randomUUID(), content: 'Stop supervision now with the supervise tool (op stop) and report the final epic end-state.', requireIdle: true }).catch(() => {})
  await wait('boring-orchestrator', osid, 3, 600000).catch(() => {})
  receipt.supervisionAfterStop = JSON.parse(await readFile(resolve(STATE_ROOT, 'supervision.json'), 'utf8')).entries?.[osid] ? 'still-armed' : 'stopped'
  receipt.headSha = await git(['rev-parse', 'HEAD']); receipt.log = await git(['log', '--oneline', `${baseSha}..HEAD`]); receipt.remoteHead = await git(['ls-remote', '--heads', 'origin', branch]).catch(() => 'n/a')
  receipt.beads = (await br(['list', '--label', `epic:${EPIC}`])).map(b => ({ id: b.id, status: b.status, assignee: b.assignee }))
  receipt.reviewers = await sessions('boring-reviewer'); receipt.workers = await sessions('boring-worker')
  receipt.fixtureTest = await exec('npm', ['test'], { cwd: EPIC_WT + '/apps/factory-playground/src/fixtures/demo-repo' }).then(() => 'pass').catch(e => 'FAIL: ' + (e.stdout || '').slice(-300))
  const out = process.env.RECEIPT_PATH ?? resolve(EPIC_WT, 'apps/factory-playground/workspace/factory-runs', `recovery-${EPIC}.json`)
  await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(receipt, null, 2)); console.log('\n=== RECEIPT ===\n' + JSON.stringify(receipt, null, 2)); console.log('receipt:', out)
} finally {
  if (osid) await call('POST', `/boring-orchestrator/sessions/${osid}/prompt`, { requestId: randomUUID(), clientNonce: randomUUID(), content: 'Stop supervision with the supervise tool (op stop).', requireIdle: true }).catch(() => {})
}
