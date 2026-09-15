import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { AgentGateway, AgentSessionConnection, AgentTool, AuthorizedAgentScope } from '@hachej/boring-agent/shared'

import { agreeIntent, openIntent, readIntent } from '../memoryFiles'
import { createSessionTracker } from '../reloadTools'
import { createRunAgentTools } from '../runAgentTools'

function resultText(result: Awaited<ReturnType<AgentTool['execute']>>): string {
  return result.content.map((part) => 'text' in part ? part.text : '').join('')
}

async function poll(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition was not met')
}

describe('fresh agent run tools', () => {
  test('allows one builder, records its final text, and prompts the live colleague', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-builder-'))
    await openIntent(root, 'suppliers', 'I need suppliers.')
    await agreeIntent(root, 'suppliers', 'A supplier list.')
    const tracker = createSessionTracker()
    tracker.remember('live-colleague')

    let releaseBuilder!: () => void
    const builderGate = new Promise<void>((resolve) => { releaseBuilder = resolve })
    const prompts: Array<{ agentTypeId: string; content: string }> = []
    const scope = { workspaceScopeId: 'workspace', authSubjectId: 'user' } as AuthorizedAgentScope
    const gateway = {
      async createSession(input: { agentTypeId: string }) {
        return { agentTypeId: input.agentTypeId, sessionId: `${input.agentTypeId}-session` }
      },
      async readSessionState(input: { ref: { agentTypeId: string; sessionId: string } }) {
        return { ref: input.ref, seq: 0, summary: { status: 'idle' }, state: { messages: [] } }
      },
      async connectSession(input: { ref: { agentTypeId: string; sessionId: string } }) {
        const ref = input.ref
        const connection = {
          ref,
          events: (async function* () {
            if (ref.agentTypeId !== 'builder') return
            await builderGate
            yield {
              ref,
              seq: 1,
              event: {
                type: 'message-end',
                seq: 1,
                messageId: 'answer',
                final: { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Suppliers can now be listed.' }] },
              },
            }
            yield { ref, seq: 2, event: { type: 'agent-end', seq: 2, turnId: 'turn', status: 'ok' } }
          })(),
          async send(input: { content: string }) {
            prompts.push({ agentTypeId: ref.agentTypeId, content: input.content })
            return { accepted: true, disposition: 'prompt', clientNonce: 'nonce' }
          },
          async close() {},
        }
        return connection as unknown as AgentSessionConnection
      },
    } as unknown as AgentGateway

    const tools = createRunAgentTools({ workspaceRoot: root, scope, getGateway: () => gateway, sessions: tracker })
    const runBuilder = tools.find((tool) => tool.name === 'run_builder')!
    const first = await runBuilder.execute({ slug: 'suppliers' }, { sessionId: 'live-colleague' } as never)
    expect(resultText(first)).toBe('started')
    expect((await readIntent(root, 'suppliers'))?.status).toBe('building')

    const second = await runBuilder.execute({ slug: 'suppliers' }, { sessionId: 'live-colleague' } as never)
    expect(resultText(second)).toBe('a build is already running')

    releaseBuilder()
    await poll(async () => (await readIntent(root, 'suppliers'))?.status === 'built')
    const intent = await readIntent(root, 'suppliers')
    expect(intent?.body).toContain('Builder: Suppliers can now be listed.')
    expect(prompts).toContainEqual({ agentTypeId: 'builder', content: 'Build intent suppliers' })
    expect(prompts.find((entry) => entry.agentTypeId === 'default')?.content).toBe(
      '[system event] The builder finished intent suppliers: Suppliers can now be listed. Tell the user in one or two sentences and offer to show it.',
    )
  })
})
