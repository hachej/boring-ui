import { expectTypeOf, test } from 'vitest'

import type {
  Sandbox,
  SandboxCapability,
  ExecOptions,
  ExecResult,
  IsolatedCodeInput,
  IsolatedCodeOutput,
} from '../sandbox'

test('SandboxCapability is a union of known strings', () => {
  expectTypeOf<'exec'>().toMatchTypeOf<SandboxCapability>()
  expectTypeOf<'isolated-code'>().toMatchTypeOf<SandboxCapability>()
  expectTypeOf<SandboxCapability>().toMatchTypeOf<string>()
})

test('Sandbox contract', () => {
  expectTypeOf<Sandbox>().toMatchTypeOf<{
    readonly id: string
    readonly placement: 'server' | 'remote' | 'browser'
    readonly provider: string
    readonly capabilities: readonly SandboxCapability[]
  }>()

  expectTypeOf<Sandbox['exec']>().returns.resolves.toEqualTypeOf<ExecResult>()
  expectTypeOf<Sandbox['dispose']>().toEqualTypeOf<(() => Promise<void>) | undefined>()
  expectTypeOf<Sandbox['executeIsolatedCode']>().toEqualTypeOf<
    ((input: IsolatedCodeInput) => Promise<IsolatedCodeOutput>) | undefined
  >()
})

test('ExecResult uses Uint8Array not Buffer', () => {
  expectTypeOf<ExecResult['stdout']>().toEqualTypeOf<Uint8Array>()
  expectTypeOf<ExecResult['stderr']>().toEqualTypeOf<Uint8Array>()
  expectTypeOf<ExecResult['exitCode']>().toEqualTypeOf<number>()
  expectTypeOf<ExecResult['durationMs']>().toEqualTypeOf<number>()
  expectTypeOf<ExecResult['truncated']>().toEqualTypeOf<boolean>()
  expectTypeOf<ExecResult['stdoutEncoding']>().toEqualTypeOf<'utf-8' | 'binary' | undefined>()
  expectTypeOf<ExecResult['stderrEncoding']>().toEqualTypeOf<'utf-8' | 'binary' | undefined>()
})

test('ExecOptions has onHeartbeat callback', () => {
  expectTypeOf<NonNullable<ExecOptions['onHeartbeat']>>().parameters.toEqualTypeOf<[elapsedMs: number]>()
  expectTypeOf<ExecOptions['signal']>().toEqualTypeOf<AbortSignal | undefined>()
  expectTypeOf<ExecOptions['timeoutMs']>().toEqualTypeOf<number | undefined>()
  expectTypeOf<ExecOptions['maxOutputBytes']>().toEqualTypeOf<number | undefined>()
})

test('IsolatedCodeInput/Output shapes', () => {
  expectTypeOf<IsolatedCodeInput>().toMatchTypeOf<{
    code: string
    language: 'python' | 'shell'
  }>()
  expectTypeOf<IsolatedCodeInput['resources']>().toEqualTypeOf<
    { cpuCores?: number; memoryMb?: number; gpu?: string } | undefined
  >()
  expectTypeOf<IsolatedCodeOutput['sandboxId']>().toEqualTypeOf<string>()
  expectTypeOf<IsolatedCodeOutput['exitCode']>().toEqualTypeOf<number>()
})
