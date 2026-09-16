#!/usr/bin/env -S tsx
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

import {
  evaluateAssertions,
  type AssertionResult,
  type ObservedToolCall,
  type TurnObservation,
} from './assertions.js'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CASES_PATH = path.join(APP_ROOT, 'eval', 'cases.yaml')
const WORKSPACES_ROOT = path.resolve(
  process.env.ONE_CHAT_EVAL_WORKSPACES_ROOT ?? path.join(APP_ROOT, '.eval-workspaces'),
)
const REPORTS_ROOT = path.join(APP_ROOT, 'eval', 'reports')
const SESSION_ROOT = process.env.BORING_AGENT_SESSION_ROOT ?? '/var/tmp/one-chat-eval/sessions'
const FRONT_PORT = Number(process.env.ONE_CHAT_PORT ?? 5430)
const APP_PORT = Number(process.env.SAMPLE_APP_PORT ?? 5431)
const API_ROOT = `http://127.0.0.1:${FRONT_PORT}`
const APP_URL = process.env.ONE_CHAT_APP_URL ?? `http://127.0.0.1:${APP_PORT}/`
const TURN_TIMEOUT_MS = Number(process.env.ONE_CHAT_EVAL_TURN_TIMEOUT_MS ?? 600_000)
const RUNTIME_MODE = process.env.BORING_AGENT_MODE ?? 'direct'

interface SeedFile {
  readonly path: string
  readonly content: string
}

interface EvalTurn {
  readonly message?: string
  /** Wait for and answer a card raised by an asynchronous builder completion. */
  readonly await_card?: boolean
  readonly answer_card?: string
  /** Model compaction and other asynchronous handoffs may still be settling. */
  readonly wait_before_ms?: number
}

interface EvalCase {
  readonly name: string
  readonly workspace: 'template' | 'sample'
  readonly seed?: readonly SeedFile[]
  readonly turns: readonly (string | EvalTurn)[]
  readonly expect: readonly unknown[]
}

interface ChatPart {
  readonly type?: string
  readonly id?: string
  readonly text?: string
  readonly toolName?: string
  readonly input?: unknown
}

interface ChatMessage {
  readonly id?: string
  readonly role?: string
  readonly parts?: readonly ChatPart[]
}

interface SessionState {
  readonly seq: number
  readonly status: string
  readonly messages: readonly ChatMessage[]
  readonly error?: unknown
}

interface PendingQuestion {
  readonly questionId: string
  readonly sessionId: string
  readonly answerToken: string
  readonly title?: string
  readonly context?: string
  readonly schema?: {
    readonly fields?: readonly {
      readonly name?: string
      readonly type?: string
      readonly options?: readonly { readonly label?: string; readonly value?: string }[]
    }[]
  }
}

interface CaseReport {
  readonly name: string
  readonly passed: boolean
  readonly durationMs: number
  readonly workspaceSource: string
  readonly workspaceChanges: readonly string[]
  readonly turns: readonly TurnObservation[]
  readonly assertions: readonly AssertionResult[]
  readonly error?: string
  readonly hostLogTail?: string
}

let activeHost: ChildProcess | undefined
let shuttingDown = false

function regexFrom(value: string): RegExp {
  const delimited = value.match(/^\/(.*)\/([a-z]*)$/s)
  return delimited ? new RegExp(delimited[1], delimited[2]) : new RegExp(value)
}

function parseArgs(argv: readonly string[]): { caseName?: string; keep: boolean } {
  let caseName: string | undefined
  let keep = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--keep') keep = true
    else if (arg === '--case') {
      caseName = argv[index + 1]
      if (!caseName) throw new Error('--case requires a case name')
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { caseName, keep }
}

function loadCases(): EvalCase[] {
  const parsed = parseYaml(readFileSync(CASES_PATH, 'utf8')) as { cases?: EvalCase[] }
  if (!Array.isArray(parsed?.cases)) throw new Error('eval/cases.yaml must contain a cases list')
  for (const candidate of parsed.cases) {
    if (!candidate.name || !['template', 'sample'].includes(candidate.workspace)) {
      throw new Error(`invalid case: ${JSON.stringify(candidate)}`)
    }
    if (!Array.isArray(candidate.turns) || !Array.isArray(candidate.expect)) {
      throw new Error(`case ${candidate.name} needs turns and expect lists`)
    }
  }
  return parsed.cases
}

function normalizedTurn(turn: string | EvalTurn): EvalTurn {
  const normalized = typeof turn === 'string' ? { message: turn } : turn
  if (!normalized.await_card && !normalized.message) throw new Error('eval turn needs a message or await_card')
  const message = normalized.message
    ?.replaceAll('{{app_url}}', APP_URL)
    .replace(/\{\{intent_slug:([^}]+)\}\}/g, (_match, needle: string) => {
      const intentRoot = currentWorkspace && path.join(currentWorkspace, 'agent', 'intents')
      const candidate = intentRoot && existsSync(intentRoot)
        ? readdirSync(intentRoot).find((file) => file.endsWith('.md') && file.toLowerCase().includes(needle.toLowerCase()))
        : undefined
      if (!candidate) throw new Error(`no intent slug contains ${JSON.stringify(needle)}`)
      return candidate.slice(0, -3)
    })
  return { ...normalized, ...(message === undefined ? {} : { message }) }
}

function safeCaseName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-')
}

function sourceFor(candidate: EvalCase): string {
  const template = path.join(APP_ROOT, 'template-app')
  if (candidate.workspace === 'template' && existsSync(path.join(template, 'node_modules'))) return template
  return path.join(APP_ROOT, 'sample-app')
}

function prepareWorkspace(candidate: EvalCase): { root: string; source: string } {
  mkdirSync(WORKSPACES_ROOT, { recursive: true })
  const caseRoot = path.join(WORKSPACES_ROOT, safeCaseName(candidate.name))
  const root = path.join(caseRoot, 'default')
  rmSync(caseRoot, { recursive: true, force: true })
  mkdirSync(caseRoot, { recursive: true })
  const source = sourceFor(candidate)
  cpSync(source, root, { recursive: true })
  for (const seed of candidate.seed ?? []) {
    const relative = seed.path.replace(/^\.\//, '')
    const target = path.resolve(root, relative)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`seed escapes workspace: ${seed.path}`)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, seed.content, 'utf8')
  }
  return { root, source }
}

function snapshotWorkspace(root: string): Map<string, string> {
  const snapshot = new Map<string, string>()
  const visit = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.vite') continue
      if (!relative && (entry === 'candidate' || entry === 'versions' || entry === '.one-chat')) continue
      const childRelative = path.posix.join(relative, entry)
      const child = path.join(directory, entry)
      const stat = statSync(child)
      if (stat.isDirectory()) visit(child, childRelative)
      else if (stat.isFile()) snapshot.set(childRelative, createHash('sha256').update(readFileSync(child)).digest('hex'))
    }
  }
  visit(root, '')
  return snapshot
}

function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .sort()
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${url}`, init)
  const text = await response.text()
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url} returned ${response.status}: ${text.slice(0, 500)}`)
  return (text ? JSON.parse(text) : {}) as T
}

async function waitForReady(host: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (host.exitCode !== null) throw new Error(`host exited before ready (${host.exitCode})\n${log()}`)
    try {
      const ready = await requestJson<{ status?: string }>('/ready')
      if (ready.status === 'ready') return
    } catch {
      // Startup races are expected.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`host did not become ready in 60s\n${log()}`)
}

async function startHost(workspaceRoot: string): Promise<{ host: ChildProcess; log: () => string }> {
  mkdirSync(SESSION_ROOT, { recursive: true })
  let output = ''
  const host = spawn('pnpm', ['dev:app'], {
    cwd: APP_ROOT,
    detached: true,
    env: {
      ...process.env,
      BORING_AGENT_DEFAULT_MODEL_PROVIDER: 'openai-codex',
      BORING_AGENT_DEFAULT_MODEL_ID: 'gpt-5.5',
      BORING_AGENT_SESSION_ROOT: SESSION_ROOT,
      ONE_CHAT_PORT: String(FRONT_PORT),
      SAMPLE_APP_PORT: String(APP_PORT),
      ONE_CHAT_APP_URL: APP_URL,
      ONE_CHAT_APPS_ROOT: path.dirname(workspaceRoot),
      ONE_CHAT_WORKSPACE_ROOT: workspaceRoot,
      ONE_CHAT_ALLOW_UNISOLATED_DIRECT_TOOLS: '1',
      HOST: '127.0.0.1',
      TMPDIR: '/var/tmp',
      HOME: '/home/ubuntu',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeHost = host
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-30_000)
  }
  host.stdout?.on('data', append)
  host.stderr?.on('data', append)
  const log = () => output
  await waitForReady(host, log)
  await new Promise((resolve) => setTimeout(resolve, 750))
  return { host, log }
}

async function stopHost(host: ChildProcess | undefined): Promise<void> {
  if (!host?.pid) return
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-host.pid!, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  signalGroup('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => host.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
  ])
  signalGroup('SIGKILL')
  activeHost = undefined
}

function collectToolCalls(
  state: SessionState,
  calls: Map<string, ObservedToolCall>,
  ignored: ReadonlySet<string> = new Set(),
): void {
  for (const message of state.messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool-call' || !part.toolName) continue
      const id = part.id ?? `${message.id ?? 'message'}:${part.toolName}:${JSON.stringify(part.input)}`
      if (!ignored.has(id)) calls.set(id, { name: part.toolName, input: part.input })
    }
  }
}

function collectTranscriptToolCalls(
  workspaceRoot: string,
  calls: Map<string, ObservedToolCall>,
  ignored: ReadonlySet<string> = new Set(),
): void {
  if (!existsSync(SESSION_ROOT)) return
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const target = path.join(directory, entry)
      const stat = statSync(target)
      if (stat.isDirectory()) {
        visit(target)
        continue
      }
      if (!entry.endsWith('.jsonl') || /(?:builder|documenter)--/.test(target)) continue
      const lines = readFileSync(target, 'utf8').split('\n')
      try {
        const header = JSON.parse(lines[0] ?? '{}') as { cwd?: unknown }
        if (path.resolve(String(header.cwd ?? '')) !== workspaceRoot) continue
      } catch {
        continue
      }
      for (let index = 1; index < lines.length; index += 1) {
        try {
          const record = JSON.parse(lines[index]!) as {
            id?: string
            message?: { role?: string; content?: { type?: string; id?: string; name?: string; arguments?: unknown }[] }
          }
          if (record.message?.role !== 'assistant') continue
          for (const part of record.message.content ?? []) {
            if (part.type !== 'toolCall' || !part.name) continue
            const id = `transcript:${target}:${record.id ?? index}:${part.id ?? part.name}`
            if (!ignored.has(id)) calls.set(id, { name: part.name, input: part.arguments })
          }
        } catch {
          // The final line may still be in flight; the next poll reads it again.
        }
      }
    }
  }
  visit(SESSION_ROOT)
}

function lastAssistantText(state: SessionState): string {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index]
    if (message?.role !== 'assistant') continue
    const text = (message.parts ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

async function readState(sessionId: string): Promise<SessionState> {
  const snapshot = await requestJson<{ state?: SessionState }>(
    `/api/v1/agents/default/sessions/${encodeURIComponent(sessionId)}/state`,
  )
  if (!snapshot.state || !Array.isArray(snapshot.state.messages)) {
    throw new Error(`state route returned an unexpected shape: ${JSON.stringify(snapshot).slice(0, 500)}`)
  }
  return snapshot.state
}

async function readPending(sessionId: string): Promise<PendingQuestion | undefined> {
  const result = await requestJson<{ questions?: PendingQuestion[] }>('/api/v1/questions/pending')
  return result.questions?.find((question) => question.sessionId === sessionId)
}

function followsRecommendationRule(question: PendingQuestion): boolean {
  const fields = question.schema?.fields ?? []
  if (fields.length !== 1) return false
  const options = fields[0]?.options ?? []
  return options.length >= 3
    && options.length <= 6
    && /\(recommended\)/i.test(options[0]?.label ?? '')
    && options.some((option) => /^something else$/i.test(option.label?.trim() ?? ''))
}

function answerValues(question: PendingQuestion, optionLabel: string): Record<string, string> {
  const fields = question.schema?.fields ?? []
  if (fields.length === 0) throw new Error(`question ${question.questionId} has no answer fields`)
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (!field.name) throw new Error(`question ${question.questionId} has an unnamed field`)
    const optionPattern = /^\/.+\/[a-z]*$/s.test(optionLabel) ? regexFrom(optionLabel) : undefined
    const option = field.options?.find((candidate) => optionPattern
      ? optionPattern.test(candidate.label ?? '')
      : candidate.label?.toLowerCase() === optionLabel.toLowerCase())
    if (field.options?.length && !option) {
      throw new Error(`answer option ${JSON.stringify(optionLabel)} is not in ${field.options.map((item) => item.label).join(', ')}`)
    }
    values[field.name] = option?.value ?? optionLabel
  }
  return values
}

async function submitAnswer(question: PendingQuestion, optionLabel: string): Promise<void> {
  await requestJson('/api/v1/questions/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'questions.submit',
      params: {
        questionId: question.questionId,
        sessionId: question.sessionId,
        answerToken: question.answerToken,
        values: answerValues(question, optionLabel),
      },
    }),
  })
}

async function runTurn(sessionId: string, turn: EvalTurn): Promise<TurnObservation> {
  const beforeState = await readState(sessionId)
  const beforeWorkspace = snapshotWorkspace(currentWorkspace!)
  const priorCalls = new Map<string, ObservedToolCall>()
  collectToolCalls(beforeState, priorCalls)
  collectTranscriptToolCalls(currentWorkspace!, priorCalls)
  const calls = new Map<string, ObservedToolCall>()
  const callsBeforeAnswer = new Map<string, ObservedToolCall>()
  const cardIds = new Set<string>()
  const recommendedCardIds = new Set<string>()
  const answeredQuestionIds = new Set<string>()
  let changedBeforeAnswer: string[] = []
  if (!turn.await_card) {
    const requestId = randomUUID()
    await requestJson(`/api/v1/agents/default/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId,
        clientNonce: requestId,
        content: turn.message,
        requireIdle: true,
      }),
    })
  }

  const deadline = Date.now() + TURN_TIMEOUT_MS
  while (Date.now() < deadline) {
    let state: SessionState
    let pending: PendingQuestion | undefined
    try {
      state = await readState(sessionId)
      pending = await readPending(sessionId)
    } catch (error) {
      if (activeHost?.exitCode !== null && activeHost?.exitCode !== undefined) throw error
      if (!(error instanceof TypeError) || !/fetch failed/i.test(error.message)) throw error
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      continue
    }
    const ignoredCalls = new Set(priorCalls.keys())
    collectToolCalls(state, calls, ignoredCalls)
    collectTranscriptToolCalls(currentWorkspace!, calls, ignoredCalls)
    if (pending) {
      cardIds.add(pending.questionId)
      if (followsRecommendationRule(pending)) recommendedCardIds.add(pending.questionId)
      if (answeredQuestionIds.size === 0) {
        for (const [id, call] of calls) callsBeforeAnswer.set(id, call)
        changedBeforeAnswer = changedPaths(beforeWorkspace, snapshotWorkspace(currentWorkspace!))
      }
      if (!turn.answer_card) {
        throw new Error(`turn raised a pending question (${pending.title ?? pending.questionId}) but has no answer_card`)
      }
      if (!answeredQuestionIds.has(pending.questionId)) {
        if (answeredQuestionIds.size >= 10) throw new Error('turn raised more than 10 question cards')
        await submitAnswer(pending, turn.answer_card)
        answeredQuestionIds.add(pending.questionId)
      }
    }
    if (state.status === 'error') throw new Error(`session entered error state: ${JSON.stringify(state.error)}`)
    const progressed = state.seq > beforeState.seq
    const reply = lastAssistantText(state)
    if (progressed && state.status === 'idle' && reply) {
      return {
        reply,
        toolCalls: [...calls.values()],
        toolCallsBeforeAnswer: [...callsBeforeAnswer.values()],
        cardShown: cardIds.size > 0,
        cardsShown: cardIds.size,
        recommendedCards: recommendedCardIds.size,
        changedPaths: changedPaths(beforeWorkspace, snapshotWorkspace(currentWorkspace!)),
        changedBeforeAnswer,
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`turn timed out after ${TURN_TIMEOUT_MS / 1000}s`)
}

let currentWorkspace: string | undefined

async function runCase(candidate: EvalCase, keep: boolean): Promise<CaseReport> {
  const startedAt = Date.now()
  const prepared = prepareWorkspace(candidate)
  currentWorkspace = prepared.root
  let host: ChildProcess | undefined
  let hostLog = () => ''
  const observations: TurnObservation[] = []
  let baseline = snapshotWorkspace(prepared.root)
  try {
    const started = await startHost(prepared.root)
    host = started.host
    hostLog = started.log
    baseline = snapshotWorkspace(prepared.root)
    const created = await requestJson<{ sessionId?: string }>('/api/v1/agents/default/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!created.sessionId) throw new Error('create session response did not include sessionId')
    for (const rawTurn of candidate.turns) {
      const turn = normalizedTurn(rawTurn)
      if (turn.wait_before_ms) await new Promise((resolve) => setTimeout(resolve, turn.wait_before_ms))
      observations.push(await runTurn(created.sessionId, turn))
    }
    const assertions = evaluateAssertions(candidate.expect, { workspaceRoot: prepared.root, turns: observations })
    const passed = assertions.every((result) => result.ok || result.optional)
    return {
      name: candidate.name,
      passed,
      durationMs: Date.now() - startedAt,
      workspaceSource: path.relative(APP_ROOT, prepared.source),
      workspaceChanges: changedPaths(baseline, snapshotWorkspace(prepared.root)),
      turns: observations,
      assertions,
      ...(passed ? {} : { hostLogTail: hostLog().slice(-4_000) }),
    }
  } catch (error) {
    return {
      name: candidate.name,
      passed: false,
      durationMs: Date.now() - startedAt,
      workspaceSource: path.relative(APP_ROOT, prepared.source),
      workspaceChanges: changedPaths(baseline, snapshotWorkspace(prepared.root)),
      turns: observations,
      assertions: [],
      error: error instanceof Error ? error.message : String(error),
      hostLogTail: hostLog().slice(-4_000),
    }
  } finally {
    await stopHost(host ?? activeHost)
    currentWorkspace = undefined
    if (!keep) rmSync(path.dirname(prepared.root), { recursive: true, force: true })
  }
}

function printResult(result: CaseReport): void {
  if (result.passed) {
    console.log(`PASS ${result.name}`)
    return
  }
  const failures = result.assertions.filter((assertion) => !assertion.ok && !assertion.optional)
  const detail = result.error
    ?? (failures.map((failure) => `${failure.assertion}; actual=${failure.actual}`).join(' | ') || 'unknown failure')
  console.log(`FAIL ${result.name}: ${detail}`)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const allCases = loadCases()
  const cases = args.caseName ? allCases.filter((candidate) => candidate.name === args.caseName) : allCases
  if (cases.length === 0) throw new Error(`no case named ${JSON.stringify(args.caseName)}`)
  mkdirSync(REPORTS_ROOT, { recursive: true })
  const results: CaseReport[] = []
  console.log(`One Chat eval: ${RUNTIME_MODE} runtime adapter, ${cases.length} case(s), host restarted per fresh workspace`)
  for (const candidate of cases) {
    const result = await runCase(candidate, args.keep)
    results.push(result)
    printResult(result)
  }
  const timestamp = new Date().toISOString()
  const reportPath = path.join(REPORTS_ROOT, `${timestamp.replace(/[:.]/g, '-')}.json`)
  const passed = results.filter((result) => result.passed).length
  writeFileSync(reportPath, `${JSON.stringify({ timestamp, runtimeMode: RUNTIME_MODE, passed, failed: results.length - passed, results }, null, 2)}\n`)
  console.log(`\n${passed}/${results.length} passed`)
  console.log(`Report: ${path.relative(APP_ROOT, reportPath)}`)
  return passed === results.length ? 0 : 1
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    void stopHost(activeHost).finally(() => process.exit(130))
  })
}

main().then(
  (code) => process.exit(code),
  async (error) => {
    console.error(error instanceof Error ? error.stack : error)
    await stopHost(activeHost)
    process.exit(2)
  },
)
