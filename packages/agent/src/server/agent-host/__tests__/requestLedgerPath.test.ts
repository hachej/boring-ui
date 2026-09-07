import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { getEnv, restoreEnvForTest, setEnvForTest } from '../../config/env'
import { resolveRequestLedgerPath } from '../requestLedgerPath'

const ORIGINAL_SESSION_ROOT = getEnv('BORING_AGENT_SESSION_ROOT')
afterEach(() => restoreEnvForTest('BORING_AGENT_SESSION_ROOT', ORIGINAL_SESSION_ROOT))

const WORKSPACE = '/srv/workspace'
const SESSION = '/data/pi-sessions'
const ENV_SESSION = '/data/env-sessions'

/**
 * Every host used to encode this chain itself. These cases pin the exact
 * argument shape each host passes, so a change to the single canonical resolver
 * cannot silently move any host's effective default.
 */
describe('resolveRequestLedgerPath', () => {
  it('prefers an explicit path over every fallback', () => {
    setEnvForTest('BORING_AGENT_SESSION_ROOT', ENV_SESSION)
    expect(resolveRequestLedgerPath({
      requestLedgerPath: '/explicit/ledger.sqlite',
      sessionRoot: SESSION,
      acceptSessionRootEnv: true,
      legacy: { layout: 'workspace-boring-dir', workspaceRoot: WORKSPACE },
    })).toBe('/explicit/ledger.sqlite')
  })

  it('treats a blank explicit path and a blank session root as absent', () => {
    expect(resolveRequestLedgerPath({
      requestLedgerPath: '   ',
      sessionRoot: '\t',
      legacy: { layout: 'workspace-boring-dir', workspaceRoot: WORKSPACE },
    })).toBe(join(WORKSPACE, '.boring', 'agent-request-ledger.sqlite'))
  })

  it('prefers the caller session root over the environment', () => {
    setEnvForTest('BORING_AGENT_SESSION_ROOT', ENV_SESSION)
    expect(resolveRequestLedgerPath({ sessionRoot: SESSION, acceptSessionRootEnv: true }))
      .toBe(join(SESSION, '.agent-request-ledger.sqlite'))
  })

  it('reads BORING_AGENT_SESSION_ROOT only when the host opts in', () => {
    setEnvForTest('BORING_AGENT_SESSION_ROOT', ENV_SESSION)
    expect(resolveRequestLedgerPath({ acceptSessionRootEnv: true }))
      .toBe(join(ENV_SESSION, '.agent-request-ledger.sqlite'))
    expect(resolveRequestLedgerPath({})).toBeUndefined()
  })

  it('fails closed for a host with no legacy location', () => {
    setEnvForTest('BORING_AGENT_SESSION_ROOT', undefined)
    expect(resolveRequestLedgerPath({})).toBeUndefined()
  })

  describe('per-host effective defaults', () => {
    // Standalone + workspace agent hosts: explicit → sessionRoot → env →
    // <workspaceRoot>/.boring/agent-request-ledger.sqlite.
    const workspaceHost = (input: { requestLedgerPath?: string; sessionRoot?: string }) =>
      resolveRequestLedgerPath({
        ...input,
        acceptSessionRootEnv: true,
        legacy: { layout: 'workspace-boring-dir', workspaceRoot: WORKSPACE },
      })

    // Core workspace host: its own sessionRoot chain already folded in the env,
    // and its legacy tail has no `.boring/` segment.
    const coreHost = (sessionRoot?: string) =>
      resolveRequestLedgerPath({
        sessionRoot,
        legacy: { layout: 'workspace-host-file', workspaceRoot: WORKSPACE },
      })

    it('keeps the standalone/workspace host default', () => {
      setEnvForTest('BORING_AGENT_SESSION_ROOT', undefined)
      expect(workspaceHost({})).toBe(join(WORKSPACE, '.boring', 'agent-request-ledger.sqlite'))
      expect(workspaceHost({ sessionRoot: SESSION })).toBe(join(SESSION, '.agent-request-ledger.sqlite'))
      expect(workspaceHost({ requestLedgerPath: '/x.sqlite' })).toBe('/x.sqlite')
      setEnvForTest('BORING_AGENT_SESSION_ROOT', ENV_SESSION)
      expect(workspaceHost({})).toBe(join(ENV_SESSION, '.agent-request-ledger.sqlite'))
    })

    it('keeps the core workspace host default, ignoring the environment', () => {
      setEnvForTest('BORING_AGENT_SESSION_ROOT', ENV_SESSION)
      expect(coreHost(SESSION)).toBe(join(SESSION, '.agent-request-ledger.sqlite'))
      // Matches the pre-refactor `join(sessionRoot ?? workspaceRoot, '.agent-request-ledger.sqlite')`.
      expect(coreHost(undefined)).toBe(join(WORKSPACE, '.agent-request-ledger.sqlite'))
    })

    it('keeps the createAgentHost default: session root only, never the environment', () => {
      setEnvForTest('BORING_AGENT_SESSION_ROOT', ENV_SESSION)
      expect(resolveRequestLedgerPath({ sessionRoot: SESSION }))
        .toBe(join(SESSION, '.agent-request-ledger.sqlite'))
      expect(resolveRequestLedgerPath({ sessionRoot: undefined })).toBeUndefined()
    })
  })
})
