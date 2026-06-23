import pino, { type Logger } from 'pino'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, expect } from 'vitest'

export const TEST_EVENTS = [
  'setup.start',
  'setup.complete',
  'assertion.passed',
  'assertion.failed',
  'cleanup.start',
] as const

export type TestEventName = (typeof TEST_EVENTS)[number]

type LogFields = Record<string, unknown>

class BufferDestination extends Writable {
  constructor(private readonly target: string[]) {
    super()
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const line = chunk.toString().trim()
    if (line) {
      this.target.push(line)
    }
    callback()
  }
}

const buffers = new Map<string, string[]>()
const loggers = new Map<string, Logger>()
const flushed = new Map<string, string[]>()

function testName(): string {
  return expect.getState().currentTestName ?? 'unknown-test'
}

function keyFor(test: string, taskId: string): string {
  return `${test}::${taskId}`
}

function ensureBuffer(key: string): string[] {
  const existing = buffers.get(key)
  if (existing) return existing
  const created: string[] = []
  buffers.set(key, created)
  return created
}

function ensureLogger(key: string): Logger {
  const existing = loggers.get(key)
  if (existing) return existing

  const logger = pino(
    {
      level: 'trace',
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    new BufferDestination(ensureBuffer(key)),
  )
  loggers.set(key, logger)
  return logger
}

function flushBuffer(key: string): void {
  const lines = buffers.get(key)
  if (!lines || lines.length === 0) return

  flushed.set(key, [...lines])
  console.error(`[core-test-log] ${key}`)
  for (const line of lines) {
    console.error(line)
  }
}

function clearBuffer(key: string): void {
  buffers.delete(key)
  loggers.delete(key)
}

function logEvent(
  key: string,
  event: TestEventName,
  taskId: string,
  fields?: LogFields,
): void {
  const logger = ensureLogger(key)
  logger.info({
    event,
    taskId,
    test: testName(),
    ...fields,
  })
}

export interface TaskTestContext {
  readonly taskId: string
  readonly test: string
  readonly logger: Logger
  logEvent(event: TestEventName, fields?: LogFields): void
  assertionPassed(assertion: string, fields?: LogFields): void
  assertionFailed(assertion: string, fields?: LogFields): void
}

export function withTaskId(
  taskId: string,
  run: (ctx: TaskTestContext) => Promise<void> | void,
) {
  return async () => {
    const test = testName()
    const key = keyFor(test, taskId)
    const logger = ensureLogger(key)

    const ctx: TaskTestContext = {
      taskId,
      test,
      logger,
      logEvent: (event, fields) => logEvent(key, event, taskId, fields),
      assertionPassed: (assertion, fields) =>
        logEvent(key, 'assertion.passed', taskId, { assertion, ...fields }),
      assertionFailed: (assertion, fields) =>
        logEvent(key, 'assertion.failed', taskId, { assertion, ...fields }),
    }

    ctx.logEvent('setup.start')

    try {
      await run(ctx)
      ctx.logEvent('setup.complete')
    } catch (error) {
      ctx.assertionFailed('unhandled-error', {
        error: error instanceof Error ? error.message : String(error),
      })
      flushBuffer(key)
      throw error
    } finally {
      ctx.logEvent('cleanup.start')
      if (!flushed.has(key)) {
        clearBuffer(key)
      }
    }
  }
}

export function __resetTestLogState(): void {
  for (const key of [...buffers.keys()]) clearBuffer(key)
  flushed.clear()
}

export function __peekFlushedLogs(): Array<{ key: string; lines: string[] }> {
  return [...flushed.entries()].map(([key, lines]) => ({ key, lines: [...lines] }))
}

beforeEach(() => {
  // Keep log buffers isolated even for tests that do not use withTaskId.
  __resetTestLogState()
})

afterEach(() => {
  // If a test used withTaskId and failed, logs were already flushed.
  // Passing tests should not leak any log lines into subsequent tests.
  for (const key of [...buffers.keys()]) {
    clearBuffer(key)
  }
})
