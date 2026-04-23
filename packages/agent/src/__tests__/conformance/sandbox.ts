import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { join } from 'node:path'

import type { Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'

const decoder = new TextDecoder()

export interface SandboxConformanceHarness {
  sandbox: Sandbox
  workspace: Workspace
  cleanup?: () => Promise<void>
}

export interface SandboxConformanceOptions {
  skip?: boolean
  skipReason?: string
}

export function sandboxConformance(
  adapterId: string,
  make: () => Promise<SandboxConformanceHarness>,
  opts: SandboxConformanceOptions = {},
): void {
  const scopedDescribe = opts.skip ? describe.skip : describe

  scopedDescribe(`[${adapterId}] Sandbox conformance`, () => {
    let harness: SandboxConformanceHarness
    let sandbox: Sandbox
    let workspace: Workspace

    beforeEach(async () => {
      harness = await make()
      sandbox = harness.sandbox
      workspace = harness.workspace
    })

    afterEach(async () => {
      await harness.cleanup?.()
      await sandbox.dispose?.()
    })

    test('exec returns stdout and zero exit code', async () => {
      const result = await sandbox.exec('echo hello')

      expect(decoder.decode(result.stdout)).toContain('hello')
      expect(result.exitCode).toBe(0)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test('exec propagates non-zero exit code', async () => {
      const result = await sandbox.exec('exit 7')
      expect(result.exitCode).toBe(7)
    })

    test('exec honors cwd inside workspace', async () => {
      await workspace.mkdir('nested', { recursive: true })
      await workspace.writeFile('nested/note.txt', 'cwd-ok')

      const result = await sandbox.exec('pwd && cat note.txt', {
        cwd: join(workspace.root, 'nested'),
      })
      const output = decoder.decode(result.stdout)

      expect(output).toContain('nested')
      expect(output).toContain('cwd-ok')
      expect(result.exitCode).toBe(0)
    })

    test('exec timeout returns timeout exit code', async () => {
      const result = await sandbox.exec('sleep 30', { timeoutMs: 500 })

      expect(result.exitCode).toBe(124)
      expect(result.durationMs).toBeGreaterThanOrEqual(500)
    }, 20_000)

    test('exec enforces maxOutputBytes and marks truncated', async () => {
      const result = await sandbox.exec('yes x | head -c 1000000', {
        maxOutputBytes: 1024,
      })

      expect(result.truncated).toBe(true)
      expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(1024)
    })

    test('exec onHeartbeat callback is invoked for long-running command', async () => {
      let heartbeatCount = 0
      const result = await sandbox.exec('sleep 2', {
        timeoutMs: 5_000,
        onHeartbeat() {
          heartbeatCount += 1
        },
      })

      expect(result.exitCode).toBe(0)
      expect(heartbeatCount).toBeGreaterThanOrEqual(1)
    }, 15_000)
  })
}
