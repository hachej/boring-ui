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

  test('does not export legacy AI-SDK-shaped chat hooks after the hard cutover', () => {
    const source = frontIndex()
    expect(source).not.toContain('use' + 'AgentChat')
    expect(source).not.toContain('Use' + 'AgentChatOptions')
    expect(source).not.toContain('use' + 'Sessions')
    expect(source).not.toContain('Use' + 'SessionsOptions')
    expect(source).toMatch(/usePiSessions|UsePiSessionsOptions/)
  })

  test('keeps package export map to documented package surfaces only', () => {
    expect(Object.keys(packageJson().exports ?? {}).sort()).toEqual([
      '.',
      './core',
      './eval',
      './front',
      './front/styles.css',
      './server',
      './server/agent-host/testing/gatewayConformance',
      './server/pi-session-readability',
      './server/worker',
      './shared',
    ])
  })
})
