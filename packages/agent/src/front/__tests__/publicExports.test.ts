import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('@hachej/boring-agent/front public exports', () => {
  const frontIndex = () => readFileSync('src/front/index.ts', 'utf8')
  const packageJson = () => JSON.parse(readFileSync('package.json', 'utf8')) as { exports?: Record<string, unknown> }

  test('does not export Pi-native control internals', () => {
    const source = frontIndex()
    expect(source).not.toMatch(/createRemotePiSession|RemotePiSession|remotePiSession/)
    expect(source).not.toMatch(/piChatReducer|PiChatState|createInitialPiChatState/)
    expect(source).not.toMatch(/piChatStream|parsePiChatStream/)
    expect(source).not.toMatch(/PiAgentSessionAdapter/)
  })

  test('marks legacy AI-SDK-shaped hooks as deprecated until the hard cutover removes them', () => {
    const source = frontIndex()
    expect(source).toMatch(/@deprecated[^]*useAgentChat[^]*UseAgentChatOptions/)
    expect(source).toMatch(/@deprecated[^]*useSessions[^]*UseSessionsOptions/)
  })

  test('keeps package export map to documented package surfaces only', () => {
    expect(Object.keys(packageJson().exports ?? {}).sort()).toEqual([
      '.',
      './eval',
      './front',
      './front/styles.css',
      './server',
      './shared',
    ])
  })
})
