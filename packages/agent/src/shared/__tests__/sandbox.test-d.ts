import { expectTypeOf, test } from 'vitest'
import type { WorkspaceRuntimeContext } from '../runtime'
import type { Sandbox, SandboxCapability, ExecOptions, ExecResult, IsolatedCodeInput, IsolatedCodeOutput } from '../sandbox'

test('checking Sandbox contract', () => {
  expectTypeOf<Sandbox>().toHaveProperty('id')
  expectTypeOf<Sandbox>().toHaveProperty('placement')
  expectTypeOf<Sandbox>().toHaveProperty('provider')
  expectTypeOf<Sandbox>().toHaveProperty('capabilities')
  expectTypeOf<Sandbox>().toHaveProperty('runtimeContext')
  expectTypeOf<Sandbox>().toHaveProperty('init')
  expectTypeOf<Sandbox>().toHaveProperty('exec')

  expectTypeOf<Sandbox['id']>().toEqualTypeOf<string>()
  expectTypeOf<Sandbox['placement']>().toEqualTypeOf<'server' | 'remote' | 'browser'>()
  expectTypeOf<Sandbox['provider']>().toEqualTypeOf<string>()
  expectTypeOf<Sandbox['capabilities']>().toEqualTypeOf<readonly SandboxCapability[]>()
  expectTypeOf<Sandbox['runtimeContext']>().toEqualTypeOf<WorkspaceRuntimeContext>()
  expectTypeOf<Sandbox['exec']>().toBeFunction()
})

test('checking SandboxCapability union', () => {
  expectTypeOf<'exec'>().toMatchTypeOf<SandboxCapability>()
  expectTypeOf<'isolated-code'>().toMatchTypeOf<SandboxCapability>()
  expectTypeOf<SandboxCapability>().toMatchTypeOf<string>()
})

test('checking ExecOptions contract', () => {
  expectTypeOf<ExecOptions>().toHaveProperty('cwd')
  expectTypeOf<ExecOptions>().toHaveProperty('env')
  expectTypeOf<ExecOptions>().toHaveProperty('signal')
  expectTypeOf<ExecOptions>().toHaveProperty('timeoutMs')
  expectTypeOf<ExecOptions>().toHaveProperty('maxOutputBytes')
  expectTypeOf<ExecOptions>().toHaveProperty('onHeartbeat')
})

test('checking ExecResult contract', () => {
  expectTypeOf<ExecResult>().toHaveProperty('stdout')
  expectTypeOf<ExecResult>().toHaveProperty('stderr')
  expectTypeOf<ExecResult>().toHaveProperty('exitCode')
  expectTypeOf<ExecResult>().toHaveProperty('durationMs')
  expectTypeOf<ExecResult>().toHaveProperty('truncated')

  expectTypeOf<ExecResult['stdout']>().toEqualTypeOf<Uint8Array>()
  expectTypeOf<ExecResult['stderr']>().toEqualTypeOf<Uint8Array>()
  expectTypeOf<ExecResult['exitCode']>().toEqualTypeOf<number>()
  expectTypeOf<ExecResult['truncated']>().toEqualTypeOf<boolean>()
})

test('checking IsolatedCodeInput contract', () => {
  expectTypeOf<IsolatedCodeInput>().toHaveProperty('code')
  expectTypeOf<IsolatedCodeInput>().toHaveProperty('language')
  expectTypeOf<IsolatedCodeInput['language']>().toEqualTypeOf<'python' | 'shell'>()
})

test('checking IsolatedCodeOutput contract', () => {
  expectTypeOf<IsolatedCodeOutput>().toHaveProperty('sandboxId')
  expectTypeOf<IsolatedCodeOutput>().toHaveProperty('stdout')
  expectTypeOf<IsolatedCodeOutput>().toHaveProperty('stderr')
  expectTypeOf<IsolatedCodeOutput>().toHaveProperty('exitCode')
})
