import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { AgentGateway, AgentSessionConnection, AgentTool, AuthorizedAgentScope } from '@hachej/boring-agent/shared'

import { agreeIntent, openIntent, readIntent } from '../memoryFiles'
import { createSessionTracker } from '../reloadTools'
import { createRunAgentTools, defaultBuilderStage } from '../runAgentTools'
import { createStageBus } from '../stageBus'

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

    const activityBus = createStageBus()
    const activityEvents: string[] = []
    activityBus.subscribe((event) => {
      if (event.type.startsWith('activity.')) activityEvents.push(event.type)
    })
    const tools = createRunAgentTools({
      workspaceRoot: root,
      scope,
      getGateway: () => gateway,
      sessions: tracker,
      activityBus,
    })
    const runBuilder = tools.find((tool) => tool.name === 'run_builder')!
    const first = await runBuilder.execute({ slug: 'suppliers', stage: 'build' }, { sessionId: 'live-colleague' } as never)
    expect(resultText(first)).toBe('started build')
    expect((await readIntent(root, 'suppliers'))?.status).toBe('building')
    expect(activityEvents).toEqual(['activity.started'])

    const second = await runBuilder.execute({ slug: 'suppliers', stage: 'mockup' }, { sessionId: 'live-colleague' } as never)
    expect(resultText(second)).toBe('a builder is already running')

    releaseBuilder()
    await poll(async () => (await readIntent(root, 'suppliers'))?.status === 'built')
    const intent = await readIntent(root, 'suppliers')
    expect(intent?.body).toContain('Builder build: Suppliers can now be listed.')
    expect(activityEvents).toEqual(['activity.started', 'activity.verifying', 'activity.done'])
    expect(prompts).toContainEqual({
      agentTypeId: 'builder',
      content: 'BUILD intent suppliers. Match the approved sketch at public/mockups/suppliers.html when it exists.',
    })
    expect(prompts.find((entry) => entry.agentTypeId === 'default')?.content).toBe(
      '[system event] The builder finished intent suppliers: Suppliers can now be listed. Tell the user in one or two sentences and suggest exactly one useful next step.',
    )
  })

  test('defaults new surfaces to mockup until an intent has build history', () => {
    expect(defaultBuilderStage({
      status: 'agreed',
      body: '',
      agreement: 'A new supplier list on one page.',
    })).toBe('mockup')
    expect(defaultBuilderStage({
      status: 'sketched',
      body: 'The sketch was accepted.',
      agreement: 'A new supplier list on one page.',
    })).toBe('mockup')
    expect(defaultBuilderStage({
      status: 'agreed',
      body: '- 2026-09-15 10:00 — Builder build: Suppliers can now be listed.',
      agreement: 'A new supplier list on one page.',
    })).toBe('build')
    expect(defaultBuilderStage({
      status: 'kept',
      body: '',
      agreement: 'A new supplier list on one page.',
    })).toBe('build')
    expect(defaultBuilderStage({
      status: 'agreed',
      body: '',
      agreement: 'Make the add button red.',
    })).toBe('build')
  })
})
