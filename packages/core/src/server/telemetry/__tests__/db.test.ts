import { describe, expect, it } from 'vitest'

import {
  createDatabaseTelemetry,
  createDatabaseTelemetryFromEnv,
  sanitizeTelemetryDistinctId,
  sanitizeTelemetryEventName,
  sanitizeTelemetryProperties,
} from '../db'
import type { Database } from '../../db/index'

type InsertRow = Record<string, unknown>

function createFakeDb(options: { fail?: 'sync' | 'async' } = {}): { db: Database; rows: InsertRow[] } {
  const rows: InsertRow[] = []
  const db = {
    insert() {
      if (options.fail === 'sync') throw new Error('db down')
      return {
        values(row: InsertRow) {
          if (options.fail === 'async') return Promise.reject(new Error('db down'))
          rows.push(row)
          return Promise.resolve()
        },
      }
    },
  } as unknown as Database
  return { db, rows }
}

async function flushTelemetry(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createDatabaseTelemetryFromEnv', () => {
  it('uses noop telemetry when BORING_TELEMETRY_ENABLED is unset', async () => {
    const { db, rows } = createFakeDb()
    const telemetry = createDatabaseTelemetryFromEnv(db, { appId: 'core-app' }, {})

    telemetry.capture({ name: 'app.opened' })
    await flushTelemetry()

    expect(rows).toEqual([])
  })

  it('uses noop telemetry when BORING_TELEMETRY_ENABLED is false', async () => {
    const { db, rows } = createFakeDb()
    const telemetry = createDatabaseTelemetryFromEnv(db, { appId: 'core-app' }, {
      BORING_TELEMETRY_ENABLED: 'false',
    })

    telemetry.capture({ name: 'app.opened' })
    await flushTelemetry()

    expect(rows).toEqual([])
  })

  it('stores sanitized events in the core database when enabled', async () => {
    const { db, rows } = createFakeDb()
    const telemetry = createDatabaseTelemetryFromEnv(db, { appId: 'core-app' }, {
      BORING_TELEMETRY_ENABLED: 'true',
    })

    telemetry.capture({
      name: 'agent.chat.started',
      distinctId: 'user_123',
      properties: {
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        durationMs: 12,
        prompt: 'secret prompt must not be stored',
        command: 'cat .env',
        path: '/tmp/private-path',
      },
    })
    await flushTelemetry()

    expect(rows).toEqual([
      {
        appId: 'core-app',
        eventName: 'agent.chat.started',
        distinctId: 'user_123',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_1',
          durationMs: 12,
        },
      },
    ])
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('secret prompt')
    expect(serialized).not.toContain('cat .env')
    expect(serialized).not.toContain('private-path')
  })
})

describe('createDatabaseTelemetry', () => {
  it('drops unsafe event names instead of writing rows', async () => {
    const { db, rows } = createFakeDb()
    const telemetry = createDatabaseTelemetry(db, { appId: 'core-app' })

    telemetry.capture({ name: 'secret.token./tmp/private' })
    await flushTelemetry()

    expect(rows).toEqual([])
  })

  it('falls back to anonymous for unsafe distinct ids', async () => {
    const { db, rows } = createFakeDb()
    const telemetry = createDatabaseTelemetry(db, { appId: 'core-app' })

    telemetry.capture({ name: 'app.opened', distinctId: 'user@example.com' })
    await flushTelemetry()

    expect(rows[0]).toMatchObject({ distinctId: 'anonymous' })
  })

  it('swallows sync and async database insert failures', async () => {
    const syncTelemetry = createDatabaseTelemetry(createFakeDb({ fail: 'sync' }).db, { appId: 'core-app' })
    const asyncTelemetry = createDatabaseTelemetry(createFakeDb({ fail: 'async' }).db, { appId: 'core-app' })

    expect(() => syncTelemetry.capture({ name: 'app.opened' })).not.toThrow()
    expect(() => asyncTelemetry.capture({ name: 'app.opened' })).not.toThrow()
    await flushTelemetry()
  })
})

describe('sanitizeTelemetryEventName', () => {
  it('keeps dotted event names and drops unsafe values', () => {
    expect(sanitizeTelemetryEventName('agent.chat.started')).toBe('agent.chat.started')
    expect(sanitizeTelemetryEventName('secret.token./tmp/private')).toBeUndefined()
    expect(sanitizeTelemetryEventName('../escape')).toBeUndefined()
  })
})

describe('sanitizeTelemetryDistinctId', () => {
  it('keeps safe ids and falls back for emails, tokens, and paths', () => {
    expect(sanitizeTelemetryDistinctId('user_123')).toBe('user_123')
    expect(sanitizeTelemetryDistinctId('user@example.com')).toBe('anonymous')
    expect(sanitizeTelemetryDistinctId('Bearer secret-token')).toBe('anonymous')
    expect(sanitizeTelemetryDistinctId('/tmp/private-path')).toBe('anonymous')
    expect(sanitizeTelemetryDistinctId(undefined)).toBe('anonymous')
  })
})

describe('sanitizeTelemetryProperties', () => {
  it('keeps only allowlisted primitive telemetry properties', () => {
    expect(
      sanitizeTelemetryProperties({
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        requestId: 'request_1',
        runtimeMode: 'local',
        modelProvider: 'anthropic',
        toolName: 'bash',
        panelId: 'files',
        commandId: 'open',
        status: 'ok',
        durationMs: 42,
        errorCode: 'WORKSPACE_NOT_READY',
        packageName: '@hachej/boring-core',
        packageVersion: '0.1.0',
        invalidDuration: Number.NaN,
        prompt: 'secret prompt',
        assistantOutput: 'secret answer',
        command: 'cat .env',
        stdout: 'secret output',
        path: '/tmp/private',
        stack: 'stack trace',
        headers: { authorization: 'Bearer secret' },
        nestedAllowedKey: { workspaceId: 'nested' },
        env: 'SECRET=value',
        objectValueOnAllowedKey: { unsafe: true },
        durationMsUnsafe: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      requestId: 'request_1',
      runtimeMode: 'local',
      modelProvider: 'anthropic',
      toolName: 'bash',
      panelId: 'files',
      commandId: 'open',
      status: 'ok',
      durationMs: 42,
      errorCode: 'WORKSPACE_NOT_READY',
      packageName: '@hachej/boring-core',
      packageVersion: '0.1.0',
    })
  })

  it('drops suspicious strings even on allowlisted keys', () => {
    expect(
      sanitizeTelemetryProperties({
        requestId: '/tmp/private-path',
        sessionId: 'Bearer secret-token',
        workspaceId: 'sk_live_abc123',
        toolName: 'ghp_abc123',
        modelProvider: 'anthropic',
        errorCode: 'SECRET_TOKEN',
        packageName: '@hachej/boring-core',
      }),
    ).toEqual({
      modelProvider: 'anthropic',
      packageName: '@hachej/boring-core',
    })
  })

  it('keeps lower-case stable core error codes', () => {
    expect(sanitizeTelemetryProperties({ errorCode: 'internal_error' })).toEqual({
      errorCode: 'internal_error',
    })
  })

  it('drops non-finite numbers even on allowlisted keys', () => {
    expect(
      sanitizeTelemetryProperties({
        durationMs: Number.POSITIVE_INFINITY,
        requestId: 'request_1',
      }),
    ).toEqual({ requestId: 'request_1' })
  })
})
