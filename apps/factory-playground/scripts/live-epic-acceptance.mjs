// Live Factory epic acceptance: one epic, one shared worktree. The Orchestrator plans the Bead graph,
// raises Gate 1 (plan approval) in the owner's Inbox, and on approval arms supervision and dispatches one
// Worker; the Worker pulls, commits, sandbox-tests the exact SHA, obtains a fresh_review and hands off on
// the Bead. Once every Bead is handed off, the Orchestrator runs Gate 2 (merge approval): it opens the epic
// PR, starts a live demo at the exact SHA with demo_sandbox, and raises the merge-approval question. This
// driver answers both gates itself (as the owner would) and never merges.
//
// Usage (API already running on 127.0.0.1:5230 against EPIC_WT with BORING_FACTORY_EPIC_KEY=EPIC_KEY):
//   EPIC_WT=/abs/path/to/epic-worktree EPIC_KEY=<epic key> node scripts/live-epic-acceptance.mjs
// Requires model credentials on the API process, the `br` and `gh` CLIs on PATH, and the Vercel Factory
// sandbox provider configured on the API process (BORING_FACTORY_SANDBOX_PROVIDER=vercel) for Gate 2's demo.
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
const exec = promisify(execFile)
const EPIC_WT = process.env.EPIC_WT
if (!EPIC_WT) throw new Error('EPIC_WT is required')
const EPIC = process.env.EPIC_KEY
if (!EPIC) throw new Error('EPIC_KEY is required')
const WORKSPACE_ID = 'factory-playground'
const base = 'http://127.0.0.1:5230/api/v1/agents'
const bridgeUrl = 'http://127.0.0.1:5230/api/v1/workspace-bridge/call'
const headers = { 'x-boring-workspace-id': WORKSPACE_ID, 'content-type': 'application/json' }
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

// --- Owner Inbox gate transport: the same WorkspaceBridge ask-user ops the browser front uses. ---
const bridgeCall = async (op, input, sessionId) => {
  const r = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': 'browser', 'x-boring-session-id': sessionId, 'x-boring-workspace-id': WORKSPACE_ID },
    body: JSON.stringify({ op, input, idempotencyKey: randomUUID() }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`bridge ${op}: ${r.status} ${t.slice(0, 500)}`)
  const parsed = t ? JSON.parse(t) : undefined
  if (parsed && parsed.ok === false) throw new Error(`bridge ${op} failed: ${JSON.stringify(parsed).slice(0, 500)}`)
  return parsed?.output
}
const pollPendingGate = async (sessionId, timeoutMs = 600000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const { pending } = await bridgeCall('ask-user.v1.pending', { sessionId }, sessionId)
    if (pending) return pending
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`timeout waiting for a pending ask_user question on session ${sessionId}`)
}
const answerGate = (sessionId, question, values) =>
  bridgeCall('ask-user.v1.answer', { questionId: question.questionId, sessionId, answerToken: question.answerToken, values }, sessionId)
const urlsIn = (text) => [...(text ?? '').matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[.,)\]]+$/, ''))

// --- Naming convention (docs/procedures/naming-conventions.md) assertions. ---
const GATE1_TITLE_RE = /^\[[^\]]+\] Plan approval$/
const GATE2_TITLE_RE = /^\[[^\]]+\] Merge approval$/
const ID_LIKE_RE = /#\d+|\bbr-\d+\b|\b[0-9a-f]{7,40}\b|https?:\/\//i
function assertGateTitle(re, title, label) {
  if (!re.test(title)) throw new Error(`${label} title "${title}" does not match ${re}`)
}
function assertFirstContextLineIsPlainSentence(context, label) {
  const firstLine = (context ?? '').split('\n')[0] ?? ''
  if (ID_LIKE_RE.test(firstLine)) {
    throw new Error(`${label} context's first line carries an id/URL, expected a plain sentence: "${firstLine}"`)
  }
}

// --- show-me mandatory-visual assertions (owner ruling: show-me is part of the handover process). ---
const FENCED_BLOCK_RE = /```[a-zA-Z]*\n[\s\S]*?```/
function assertHasFencedBlock(content, label) {
  if (!FENCED_BLOCK_RE.test(content)) throw new Error(`${label} is missing a fenced code/diagram block`)
}
async function assertShowMePlanArtifact(gate1, epicWorktree) {
  const artifacts = gate1.artifacts ?? []
  const showMe = artifacts.find((a) => /show-me-plan\.md$/.test(a.target ?? ''))
  if (!showMe) throw new Error(`gate 1 is missing a show-me-plan artifact; artifacts: ${JSON.stringify(artifacts)}`)
  const filePath = resolve(epicWorktree, showMe.target)
  const content = await readFile(filePath, 'utf8')
  assertHasFencedBlock(content, `show-me plan file ${filePath}`)
  console.log('\n=== show-me plan (first 40 lines of', filePath, ') ===')
  console.log(content.split('\n').slice(0, 40).join('\n'))
  return { artifact: showMe, path: filePath }
}
function assertShowMePrArtifact(gate2) {
  const artifacts = gate2.artifacts ?? []
  const showMe = artifacts.find((a) => /show-me-[0-9a-f]{7,40}\.md$/.test(a.target ?? ''))
  if (!showMe) throw new Error(`gate 2 is missing a show-me-<sha> artifact; artifacts: ${JSON.stringify(artifacts)}`)
  return showMe
}

const baseSha = await git(['rev-parse', 'HEAD'])
console.log('epic worktree base', baseSha, 'epic', EPIC)
let osid, loopOn = false
const receipt = { epic: EPIC, baseSha }
try {
  osid = process.env.ORCH_SESSION ?? await create('boring-orchestrator', `Epic ${EPIC}: Orchestrator`)
  receipt.orchestratorSessionId = osid
  console.log('orchestrator', osid, process.env.ORCH_SESSION ? '(resumed; skipping the planning prompt)' : '')
  if (!process.env.ORCH_SESSION) await prompt('boring-orchestrator', osid, [
    `Host context: your session id is ${osid}.\nOwner request for epic ${EPIC} (shared worktree = this workspace, branch ${await git(['rev-parse', '--abbrev-ref', 'HEAD'])}).`,
    'Feature name: "Farewell API" (per docs/procedures/naming-conventions.md — lead every Bead, PR, commit, and Inbox title with `[Farewell API]`). In apps/factory-playground/src/fixtures/demo-repo, add an exported farewell(name) function to src/greeting.js returning exactly `Goodbye, ${name}.` (comma, trailing period), add a focused node:test case in test/greeting.test.js, and document import + usage in that fixture README.md. Proof: `npm test` inside the fixture directory.',
    'Materialize the smallest dependency-correct Bead graph with real br commands. Then raise Gate 1 (plan approval) now with ask_user, per the factory-precedence appendix — do not skip it and do not treat this message as a pre-approval. On approval, immediately start durable supervision with the supervise tool (op start, intervalMs 120000, a prompt naming factory_status and the recovery rule), then dispatch exactly one Worker with dispatch_worker.',
    `The Worker brief must name epic ${EPIC}, the shared worktree, the pull protocol (br ready --label epic:${EPIC} --unassigned, claim one with --claim --actor <session id>), implement + stage only intended files + commit on the epic branch, exact-SHA dedicated sandbox test via the sandbox tools, adversarial fresh_review of that SHA, then a complete handoff recorded in the Bead (SHA, test evidence, review provenance) and git push of the epic branch. It must never merge or close its own Bead. Do not name a specific Bead.`,
    "When dispatch_worker returns, report the Worker's final answer and what the br/git end-states now show. On changes/defer/reject at Gate 1: revise and re-raise, or stop and report; do not arm supervision or dispatch.",
  ].join('\n'))

  const gate1 = await pollPendingGate(osid, Number(process.env.GATE_TIMEOUT_MS ?? 1800000))
  console.log('\n=== GATE 1 (plan approval) ===')
  console.log('title:', gate1.title)
  console.log('context:', gate1.context)
  assertGateTitle(GATE1_TITLE_RE, gate1.title, 'gate 1')
  assertFirstContextLineIsPlainSentence(gate1.context, 'gate 1')
  const showMePlan = await assertShowMePlanArtifact(gate1, EPIC_WT)
  console.log('gate 1 carries the show-me plan artifact:', showMePlan.artifact.target)
  receipt.gate1 = { title: gate1.title, context: gate1.context, decision: 'approve', showMePlanArtifact: showMePlan.artifact }
  await answerGate(osid, gate1, { decision: 'approve', notes: 'approved by acceptance driver' })
  loopOn = true
  console.log('gate 1 approved')

  const ready = await br(['ready', '--label', `epic:${EPIC}`])
  receipt.readyAfterPlan = ready.map(b => ({ id: b.id, labels: b.labels, title: b.title }))
  console.log('ready(epic) at gate 1:', JSON.stringify(receipt.readyAfterPlan))

  let dispatched
  for (;;) { const ws = (await call('GET', '/boring-worker/sessions')).sessions ?? []; const mine = ws.filter(w => (w.title || '').includes(osid.slice(0, 8))); if (mine.length && mine.every(w => w.status === 'idle' && w.turnCount >= 1)) break; await new Promise(r => setTimeout(r, 5000)) }
  console.log('worker session(s) finished')
  dispatched = await wait('boring-orchestrator', osid, 1)
  console.log('\n=== ORCHESTRATOR AFTER GATE 1 + DISPATCH ===\n' + lastText(dispatched))
  console.log('orchestrator tool parts:', JSON.stringify(toolNames(dispatched).slice(-16)))

  // --- Gate 2: PR + live demo + merge approval. ---
  const DEMO_CMD = process.env.DEMO_CMD ??
    "cd apps/factory-playground/src/fixtures/demo-repo && node --input-type=module -e \"import('node:http').then(h=>import('./src/greeting.js').then(({greeting,farewell})=>h.createServer((req,res)=>res.end(greeting('Owner')+' '+farewell('Owner'))).listen(3000)))\""
  await prompt('boring-orchestrator', osid, `All Beads are handed off; run Gate 2 now: open the PR, start the demo with demo_sandbox (command: \`${DEMO_CMD}\`, port 3000), and raise the merge-approval question.`)

  const gate2 = await pollPendingGate(osid, 600000)
  console.log('\n=== GATE 2 (merge approval) ===')
  console.log('title:', gate2.title)
  console.log('context:', gate2.context)
  assertGateTitle(GATE2_TITLE_RE, gate2.title, 'gate 2')
  assertFirstContextLineIsPlainSentence(gate2.context, 'gate 2')
  const showMePr = assertShowMePrArtifact(gate2)
  console.log('gate 2 carries the show-me PR artifact:', showMePr.target)
  receipt.gate2 = { title: gate2.title, context: gate2.context, decision: 'approve', showMePrArtifact: showMePr }

  const urls = urlsIn(gate2.context)
  const prUrl = urls.find((u) => u.includes('github.com') && u.includes('/pull/'))
  const demoUrl = urls.find((u) => u !== prUrl)
  if (!prUrl) throw new Error(`gate 2 context is missing a PR URL: ${gate2.context}`)
  if (!demoUrl) throw new Error(`gate 2 context is missing a demo URL: ${gate2.context}`)
  receipt.prUrl = prUrl
  receipt.demoUrl = demoUrl
  console.log('gate 2 PR url:', prUrl)
  console.log('gate 2 demo url:', demoUrl)

  const prBefore = JSON.parse((await exec('gh', ['pr', 'view', prUrl, '--json', 'url,title,body'])).stdout)
  if (!prBefore.body.includes('## Owner Review')) throw new Error('PR body is missing "## Owner Review"')
  if (!prBefore.body.includes('## Show me')) throw new Error('PR body is missing "## Show me"')
  if (!prBefore.body.includes('## Handover')) throw new Error('PR body is missing "## Handover"')
  const showMeSection = prBefore.body.split('## Show me')[1]?.split(/\n## /)[0] ?? ''
  assertHasFencedBlock(showMeSection, 'PR body "## Show me" section')
  if (!prBefore.title.startsWith('[')) throw new Error(`PR title "${prBefore.title}" does not start with "["`)
  console.log('PR body carries Owner Review + Show me + Handover sections; PR title:', prBefore.title)

  const demoResponse = await fetch(demoUrl)
  const demoBody = await demoResponse.text()
  receipt.demoBody = demoBody.slice(0, 2000)
  if (demoResponse.status !== 200) throw new Error(`demo URL returned ${demoResponse.status}`)
  if (!demoBody.includes('Goodbye, Owner.')) throw new Error(`demo body is missing "Goodbye, Owner.": ${demoBody.slice(0, 500)}`)
  console.log('demo is live and serves the feature at the exact SHA')

  await answerGate(osid, gate2, { decision: 'approve', notes: 'approved by acceptance driver' })
  console.log('gate 2 approved')

  const afterGate2 = await wait('boring-orchestrator', osid, 2, 900000)
  console.log('\n=== ORCHESTRATOR AFTER GATE 2 ===\n' + lastText(afterGate2))

  const prAfter = JSON.parse((await exec('gh', ['pr', 'view', prUrl, '--json', 'state'])).stdout)
  if (prAfter.state !== 'OPEN') throw new Error(`PR must stay OPEN after Gate 2 approval; observed state ${prAfter.state}`)
  console.log('PR is still OPEN (never merged) after Gate 2 approval')

  await prompt('boring-orchestrator', osid, 'Stop the demo (demo_sandbox stop) and stop supervision (supervise stop).')
  const stopped = await wait('boring-orchestrator', osid, 3, 600000)
  loopOn = false
  console.log('\n=== ORCHESTRATOR AFTER STOP ===\n' + lastText(stopped))

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

  if (process.env.KEEP_PR !== '1') {
    await exec('gh', ['pr', 'close', prUrl, '--comment', 'acceptance run; closing test PR']).catch(() => {})
    console.log('closed test PR', prUrl)
  } else {
    console.log('KEEP_PR=1: leaving', prUrl, 'open')
  }

  const out = process.env.RECEIPT_PATH ?? resolve(EPIC_WT, 'apps/factory-playground/workspace/factory-runs', `live-${EPIC}.json`)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(receipt, null, 2))
  console.log('receipt:', out)
  console.log('\n=== RECEIPT ===\n' + JSON.stringify(receipt, null, 2))
} finally {
  if (loopOn && osid) await prompt('boring-orchestrator', osid, 'Stop supervision with the supervise tool (op stop).').catch(() => {})
}
