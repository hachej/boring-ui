import { expectTypeOf, test } from 'vitest'

import type {
  UiBridge,
  UiState,
  UiCommand,
  CommandResult,
} from '../ui-bridge'

test('UiBridge contract', () => {
  expectTypeOf<UiBridge['getState']>().returns.resolves.toEqualTypeOf<UiState | null>()
  expectTypeOf<UiBridge['setState']>().parameters.toEqualTypeOf<[state: UiState]>()
  expectTypeOf<UiBridge['postCommand']>().returns.resolves.toEqualTypeOf<CommandResult>()

  type UnsubFn = ReturnType<UiBridge['subscribeCommands']>
  expectTypeOf<UnsubFn>().toEqualTypeOf<() => void>()
})

test('UiCommand uses camelCase kind', () => {
  const openFile: UiCommand = { kind: 'openFile', params: { path: '/a.ts' } }
  expectTypeOf(openFile).toMatchTypeOf<UiCommand>()

  const openPanel: UiCommand = { kind: 'openPanel', params: { id: '1', component: 'code' } }
  expectTypeOf(openPanel).toMatchTypeOf<UiCommand>()

  const showNotif: UiCommand = { kind: 'showNotification', params: { msg: 'hi' } }
  expectTypeOf(showNotif).toMatchTypeOf<UiCommand>()
})

test('UiCommand is extensible via string kind', () => {
  const custom: UiCommand = { kind: 'customAction', params: { foo: 'bar' } }
  expectTypeOf(custom).toMatchTypeOf<UiCommand>()
})

test('CommandResult shape', () => {
  expectTypeOf<CommandResult>().toEqualTypeOf<{
    seq: number
    status: 'ok' | 'error'
    error?: { code: string; message: string }
  }>()
  expectTypeOf<CommandResult['seq']>().toEqualTypeOf<number>()
})

test('UiState is a generic record', () => {
  expectTypeOf<UiState>().toEqualTypeOf<Record<string, unknown>>()
})
