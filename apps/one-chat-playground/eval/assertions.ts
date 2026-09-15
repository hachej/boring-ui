import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export interface ObservedToolCall {
  readonly name: string
  readonly input?: unknown
}

export interface TurnObservation {
  readonly reply: string
  readonly toolCalls: readonly ObservedToolCall[]
  readonly toolCallsBeforeAnswer: readonly ObservedToolCall[]
  readonly cardShown: boolean
  readonly changedBeforeAnswer: readonly string[]
}

export interface AssertionContext {
  readonly workspaceRoot: string
  readonly turns: readonly TurnObservation[]
}

export interface AssertionResult {
  readonly assertion: string
  readonly ok: boolean
  readonly optional: boolean
  readonly actual: string
}

type AssertionSpec = Record<string, unknown> & {
  readonly optional?: boolean
  readonly turn?: number
  readonly before_answer?: boolean
}

const JARGON = /\b(file|folder|git|commit|branch|reload|server|terminal|code|repo|tool)\b/i
const META_KEYS = new Set(['optional', 'turn', 'before_answer'])

function regexFrom(value: unknown): RegExp {
  if (typeof value !== 'string') throw new Error(`expected a regex string, got ${JSON.stringify(value)}`)
  const delimited = value.match(/^\/(.*)\/([a-z]*)$/s)
  return delimited ? new RegExp(delimited[1], delimited[2]) : new RegExp(value)
}

function globRegex(glob: string): RegExp {
  let source = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*' && glob[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char!.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

function listFiles(root: string, relative = ''): string[] {
  const directory = path.join(root, relative)
  if (!existsSync(directory)) return []
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const child = path.posix.join(relative.split(path.sep).join('/'), entry)
    const absolute = path.join(root, child)
    if (statSync(absolute).isDirectory()) files.push(...listFiles(root, child))
    else files.push(child)
  }
  return files
}

function matchingFiles(root: string, pattern: string): string[] {
  const normalized = pattern.replace(/^\.\//, '').split(path.sep).join('/')
  if (!/[?*]/.test(normalized)) return existsSync(path.join(root, normalized)) ? [normalized] : []
  const matcher = globRegex(normalized)
  return listFiles(root).filter((candidate) => matcher.test(candidate))
}

function selectTurn(spec: AssertionSpec, context: AssertionContext): TurnObservation | undefined {
  if (spec.turn === undefined) return context.turns.at(-1)
  if (!Number.isInteger(spec.turn) || spec.turn < 1) return undefined
  return context.turns[spec.turn - 1]
}

function toolMatches(call: ObservedToolCall, expected: unknown): boolean {
  if (expected === 'bash-with-rm') {
    return call.name === 'bash' && /(^|[;&|\s])rm(?:\s|$)/i.test(JSON.stringify(call.input ?? ''))
  }
  if (typeof expected !== 'string') return false
  if (/^\/.+\/[a-z]*$/s.test(expected)) return regexFrom(expected).test(call.name)
  return call.name === expected
}

function argsMatch(actual: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return Object.is(actual, expected)
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  return Object.entries(expected).every(([key, value]) => argsMatch((actual as Record<string, unknown>)[key], value))
}

function assertionEntry(spec: AssertionSpec): [string, unknown] {
  const entries = Object.entries(spec).filter(([key]) => !META_KEYS.has(key))
  if (entries.length !== 1) throw new Error(`assertion must have one assertion key: ${JSON.stringify(spec)}`)
  return entries[0]!
}

function format(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value)
}

export function evaluateAssertions(rawAssertions: readonly unknown[], context: AssertionContext): AssertionResult[] {
  return rawAssertions.map((raw) => {
    const spec = raw as AssertionSpec
    const optional = spec?.optional === true
    let assertion = JSON.stringify(raw)
    try {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('assertion must be an object')
      const [kind, expected] = assertionEntry(spec)
      assertion = `${kind}: ${format(expected)}${spec.turn ? ` (turn ${spec.turn})` : ''}${spec.before_answer ? ' (before answer)' : ''}`
      const turn = selectTurn(spec, context)
      const reply = turn?.reply ?? ''
      const calls = spec.turn === undefined
        ? context.turns.flatMap((item) => spec.before_answer ? item.toolCallsBeforeAnswer : item.toolCalls)
        : (spec.before_answer ? turn?.toolCallsBeforeAnswer : turn?.toolCalls) ?? []

      let ok = false
      let actual = ''
      switch (kind) {
        case 'reply_matches': {
          ok = regexFrom(expected).test(reply)
          actual = reply
          break
        }
        case 'reply_not_matches': {
          ok = !regexFrom(expected).test(reply)
          actual = reply
          break
        }
        case 'tool_called': {
          ok = calls.some((call) => toolMatches(call, expected))
          actual = calls.map((call) => call.name).join(', ') || '(none)'
          break
        }
        case 'tool_called_with': {
          const value = expected as { name?: unknown; args_match?: unknown }
          ok = calls.some((call) => toolMatches(call, value?.name) && argsMatch(call.input, value?.args_match))
          actual = calls.map((call) => `${call.name} ${JSON.stringify(call.input ?? {})}`).join(', ') || '(none)'
          break
        }
        case 'tool_not_called': {
          ok = !calls.some((call) => toolMatches(call, expected))
          if (spec.before_answer && context.turns.some((item) => item.changedBeforeAnswer.length > 0)) ok = false
          const changed = context.turns.flatMap((item) => item.changedBeforeAnswer)
          actual = `${calls.map((call) => call.name).join(', ') || '(none)'}${changed.length ? `; changed: ${changed.join(', ')}` : ''}`
          break
        }
        case 'file_exists': {
          const files = matchingFiles(context.workspaceRoot, String(expected))
          ok = files.length > 0
          actual = files.join(', ') || '(none)'
          break
        }
        case 'file_contains':
        case 'file_not_contains': {
          const value = expected as { path?: unknown; regex?: unknown }
          const files = matchingFiles(context.workspaceRoot, String(value?.path ?? ''))
          const matcher = regexFrom(value?.regex)
          const matches = files.filter((file) => matcher.test(readFileSync(path.join(context.workspaceRoot, file), 'utf8')))
          ok = kind === 'file_contains' ? matches.length > 0 : files.length > 0 && matches.length === 0
          actual = `files=${files.join(', ') || '(none)'}; matching=${matches.join(', ') || '(none)'}`
          break
        }
        case 'intent_status': {
          const value = expected as { slug?: unknown; status?: unknown }
          const intentRoot = path.join(context.workspaceRoot, 'agent', 'intents')
          const slugPattern = globRegex(`${String(value?.slug ?? '')}.md`)
          const candidates = existsSync(intentRoot)
            ? readdirSync(intentRoot).filter((file) => slugPattern.test(file))
            : []
          const statuses = candidates.map((file) => {
            const body = readFileSync(path.join(intentRoot, file), 'utf8')
            return `${file.replace(/\.md$/, '')}:${body.match(/^status:\s*(\S+)/m)?.[1] ?? '(missing)'}`
          })
          const expectedStatus = String(value?.status ?? '')
          ok = statuses.some((entry) => {
            const status = entry.slice(entry.lastIndexOf(':') + 1)
            return /^\/.+\/[a-z]*$/s.test(expectedStatus)
              ? regexFrom(expectedStatus).test(status)
              : status === expectedStatus
          })
          actual = statuses.join(', ') || '(none)'
          break
        }
        case 'card_shown': {
          const shown = spec.turn === undefined
            ? context.turns.some((item) => item.cardShown)
            : turn?.cardShown === true
          ok = shown === expected
          actual = String(shown)
          break
        }
        case 'no_jargon': {
          const match = reply.match(JARGON)
          ok = expected === true && !match
          actual = match ? `matched ${JSON.stringify(match[0])} in ${JSON.stringify(reply)}` : reply
          break
        }
        default:
          throw new Error(`unknown assertion ${kind}`)
      }
      return { assertion, ok, optional, actual }
    } catch (error) {
      return {
        assertion,
        ok: false,
        optional,
        actual: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
