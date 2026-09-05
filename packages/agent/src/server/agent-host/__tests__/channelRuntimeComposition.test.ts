import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentGateway, AuthorizedAgentScope } from '../../../shared/gateway/types'
import type { PiChatEvent } from '../../../shared/chat'
import {
  createAgentHostChannelRuntime,
  createAgentHostChannelStorage,
  type AgentHostChannelStorage,
} from '../channelRuntimeComposition'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Agent Host channel runtime composition', () => {
  test('durably acknowledges inbound and resolves the restarted outbound adapter registry', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-host-channel-runtime-'))
    temporaryDirectories.push(sessionRoot)
    const scope = {} as AuthorizedAgentScope
    let storage: AgentHostChannelStorage = createAgentHostChannelStorage({ sessionRoot })
    let eventIndex = 0
    let turn = 0
    const createSession = vi.fn(async () => {
      const sessionId = 'channel-session'
      await storage.events.createSessionStream(
        { workspaceScopeId: 'workspace-1', sessionId },
        { agentTypeId: 'default', authSubjectId: 'member-1' },
      )
      return { agentTypeId: 'default', sessionId }
    })
    const append = async (sessionId: string, chunk: PiChatEvent) => {
      await storage.events.appendEvent(`sessions/workspace-1/${sessionId}`, {
        v: 1,
        eventIndex: eventIndex++,
        timestamp: Date.now(),
        sessionId,
        chunk,
      })
    }
    const gateway = {
      createSession,
      async readSessionState({ ref }: { ref: { agentTypeId: string; sessionId: string } }) {
        return {
          ref,
          seq: 0,
          summary: { ref, title: '', status: 'idle', createdAt: 0, updatedAt: 0 },
          state: {},
        }
      },
      async connectSession({ ref }: { ref: { agentTypeId: string; sessionId: string } }) {
        return {
          ref,
          events: (async function* () {})(),
          async send(input: { content: string }) {
            const turnId = `turn-${++turn}`
            await append(ref.sessionId, { type: 'agent-start', seq: 1, turnId })
            await append(ref.sessionId, {
              type: 'message-end',
              seq: 2,
              messageId: `${turnId}-assistant`,
              final: {
                id: `${turnId}-assistant`,
                role: 'assistant',
                turnId,
                parts: [{ type: 'text', text: `reply:${input.content}` }],
              },
            })
            await append(ref.sessionId, { type: 'agent-end', seq: 3, turnId, status: 'ok' })
            return { accepted: true, cursor: 0, disposition: 'prompt', clientNonce: 'channel' }
          },
          async close() {},
        }
      },
    } as unknown as AgentGateway

    const firstSent: string[] = []
    const first = createAgentHostChannelRuntime<string>({
      gateway,
      storage,
      resolveAuthorizedScope: async (binding) => {
        expect(binding).toMatchObject({ workspaceId: 'workspace-1', authSubjectId: 'member-1' })
        return scope
      },
      outboundAdapters: new Map([['fake', {
        renderOutbound: (completed) => [completed.text],
        send: async ({ message }) => { firstSent.push(message) },
      }]]),
    })
    first.provision({
      channel: 'fake',
      conversationKey: 'provider-thread',
      agentTypeId: 'default',
      workspaceId: 'workspace-1',
      authSubjectId: 'member-1',
    })
    expect(first.acceptInbound({
      channel: 'fake',
      conversationKey: 'provider-thread',
      providerMessageId: 'provider-1',
      text: 'hello',
      receivedAt: Date.now(),
    }, 'default')).toMatchObject({ accepted: true, duplicate: false })
    await first.waitForIdle()
    expect(firstSent).toEqual(['reply:hello'])
    await first.close()
    storage.close()

    storage = createAgentHostChannelStorage({ sessionRoot })
    const restartedSent: string[] = []
    const restartedAdapter = {
      renderOutbound: (completed: { text: string }) => [completed.text],
      send: async ({ message }: { message: string }) => { restartedSent.push(message) },
    }
    const restarted = createAgentHostChannelRuntime<string>({
      gateway,
      storage,
      resolveAuthorizedScope: async () => scope,
      outboundAdapters: new Map([['fake', restartedAdapter]]),
    })
    expect(restarted.outboundAdapters.get('fake')).toBe(restartedAdapter)
    expect(restarted.acceptInbound({
      channel: 'fake',
      conversationKey: 'provider-thread',
      providerMessageId: 'provider-1',
      text: 'hello replay',
      receivedAt: Date.now(),
    }, 'default')).toMatchObject({ accepted: true, duplicate: true })
    expect(restarted.acceptInbound({
      channel: 'fake',
      conversationKey: 'provider-thread',
      providerMessageId: 'provider-2',
      text: 'again',
      receivedAt: Date.now(),
    }, 'default')).toMatchObject({ accepted: true, duplicate: false })
    await restarted.waitForIdle()

    expect(createSession).toHaveBeenCalledTimes(1)
    expect(restartedSent).toEqual(['reply:again'])
    await restarted.close()
    storage.close()
  })
})
