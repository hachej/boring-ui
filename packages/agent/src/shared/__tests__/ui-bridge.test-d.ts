import { expectTypeOf, test } from 'vitest'
import type { UiBridge, UiState, UiCommand, CommandResult } from '../ui-bridge'

test('checking UiBridge contract', () => {
  expectTypeOf<UiBridge>().toHaveProperty('getState')
  expectTypeOf<UiBridge>().toHaveProperty('setState')
  expectTypeOf<UiBridge>().toHaveProperty('postCommand')
  expectTypeOf<UiBridge>().toHaveProperty('subscribeCommands')

  expectTypeOf<UiBridge['getState']>().toBeFunction()
  expectTypeOf<UiBridge['setState']>().toBeFunction()
  expectTypeOf<UiBridge['postCommand']>().toBeFunction()
  expectTypeOf<UiBridge['subscribeCommands']>().toBeFunction()
})

test('checking UiState is a generic record', () => {
  expectTypeOf<UiState>().toEqualTypeOf<Record<string, unknown>>()
})

test('checking UiCommand discriminated union', () => {
  expectTypeOf<UiCommand>().toHaveProperty('kind')
  expectTypeOf<UiCommand>().toHaveProperty('params')

  const openFile: UiCommand = { kind: 'openFile', params: { path: '/test' } }
  expectTypeOf(openFile).toMatchTypeOf<UiCommand>()

  const openPanel: UiCommand = { kind: 'openPanel', params: { id: '1', component: 'x' } }
  expectTypeOf(openPanel).toMatchTypeOf<UiCommand>()
})

test('checking CommandResult contract', () => {
  expectTypeOf<CommandResult>().toHaveProperty('seq')
  expectTypeOf<CommandResult>().toHaveProperty('status')
  expectTypeOf<CommandResult>().toHaveProperty('error')

  expectTypeOf<CommandResult['seq']>().toEqualTypeOf<number>()
  expectTypeOf<CommandResult['status']>().toEqualTypeOf<'ok' | 'error'>()
})
