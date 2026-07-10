import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { createAgent } from '@hachej/boring-agent/core'
import { describe, expect, it } from 'vitest'

import type { AgentHarness, AgentHarnessFactoryInput, AgentSendInput, RunContext } from '../../shared/harness'
import type { AgentEvent } from '../../shared/events'
import type { AgentTool } from '../../shared/tool'
import { PiSessionStore } from '../harness/pi-coding-agent/sessions'
import type { PiAgentPromptInput, PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../pi-chat/PiAgentSessionAdapter'

describe('createAgent pure smoke', () => {
  it('runs a Node-hosted runtime none turn with a fake harness and no workspace', async () => {
    const sessionStorageRoot = await mkdtemp(join(tmpdir(), 'boring-agent-pure-smoke-'))
    const harness = createPureSmokeHarnessFactory()
    const agent = createAgent({
      runtime: 'none',
      sessionStorageRoot,
      harnessFactory: harness.factory,
      tools: [createHostOnlyTool()],
    })

    try {
      const events = await collectEvents(agent.send({ content: 'hello from pure mode' }))
      expect(events.map((event) => event.chunk.type)).toEqual(expect.arrayContaining([
        'agent-start',
        'message-delta',
        'agent-end',
      ]))
      expect(events.map((event) => event.eventIndex)).toEqual(events.map((_, index) => index))
      expect(events[0]).toMatchObject({
        eventIndex: 0,
        sessionId: expect.any(String),
        chunk: { type: 'agent-start' },
      })
      expect(events.at(-1)).toMatchObject({
        sessionId: events[0]?.sessionId,
        chunk: { type: 'agent-end', status: 'ok' },
      })
      expect(events.every((event) => event.sessionId === events[0]?.sessionId)).toBe(true)
      expect(events.some((event) => event.chunk.type === 'message-delta' && event.chunk.delta === 'pong')).toBe(true)

      const sealedCwd = join(sessionStorageRoot, '.runtime-none')
      expect(harness.inputs).toHaveLength(1)
      expect(harness.inputs[0]).toMatchObject({
        cwd: sealedCwd,
        runtimeCwd: sealedCwd,
        sessionRoot: sessionStorageRoot,
        sessionStorageCwd: '',
      })
      expect(harness.inputs[0]?.tools.map((tool) => tool.name)).toEqual(['host_echo'])

      expect(harness.contexts.length).toBeGreaterThan(0)
      for (const ctx of harness.contexts) {
        expect(ctx).toMatchObject({ workdir: sealedCwd })
        expect(ctx.workspaceId).toBeUndefined()
        expect(ctx.userId).toBeUndefined()
      }
      expect(harness.prompts).toEqual(['hello from pure mode'])
      expect(JSON.stringify({
        contexts: harness.contexts,
        inputs: harness.inputs,
        prompts: harness.prompts,
      })).not.toContain(process.cwd())
      expect(JSON.stringify({
        contexts: harness.contexts,
        inputs: harness.inputs,
        prompts: harness.prompts,
      })).not.toContain('/workspace')

      const persistedFiles = await readdir(sessionStorageRoot)
      expect(persistedFiles.filter((file) => file.endsWith('.jsonl'))).toHaveLength(1)
      const freshStore = new PiSessionStore('', { sessionRoot: sessionStorageRoot, storageCwd: '' })
      const persistedSessions = await freshStore.list({})
      expect(persistedSessions).toHaveLength(1)
      expect(persistedSessions[0]?.id).toBe(events[0]?.sessionId)
      await expect(freshStore.load({}, persistedSessions[0]!.id)).resolves.toMatchObject({
        id: persistedSessions[0]!.id,
      })
    } finally {
      await agent.dispose()
      await rm(sessionStorageRoot, { recursive: true, force: true })
    }
  })
})

function createPureSmokeHarnessFactory() {
  const inputs: AgentHarnessFactoryInput[] = []
  const prompts: string[] = []
  const contexts: RunContext[] = []

  const factory = async (input: AgentHarnessFactoryInput): Promise<AgentHarness & {
    getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<PiAgentSessionAdapter>
  }> => {
    inputs.push(input)
    const sessions = new PiSessionStore(input.runtimeCwd ?? input.cwd, {
      sessionDir: input.sessionDir,
      sessionNamespace: input.sessionNamespace,
      sessionRoot: input.sessionRoot,
      storageCwd: input.sessionStorageCwd,
    })
    const adapters = new Map<string, PureSmokePiSessionAdapter>()

    return {
      id: 'pure-smoke',
      placement: 'server',
      sessions,
      async getPiSessionAdapter(sendInput, ctx) {
        if (!sendInput.sessionId) throw new Error('sessionId is required')
        contexts.push(ctx)
        let adapter = adapters.get(sendInput.sessionId)
        if (!adapter) {
          adapter = new PureSmokePiSessionAdapter(sendInput.sessionId, prompts)
          adapters.set(sendInput.sessionId, adapter)
        }
        return adapter
      },
    }
  }

  return { contexts, factory, inputs, prompts }
}

function createHostOnlyTool(): AgentTool {
  return {
    name: 'host_echo',
    description: 'Host-provided echo tool.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { type: 'string' },
      },
    },
    async execute(params) {
      return { content: [{ type: 'text', text: String(params.value ?? '') }] }
    },
  }
}

async function collectEvents(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

class PureSmokePiSessionAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()
  private streaming = false
  private turn = 0

  constructor(
    private readonly sessionId: string,
    private readonly prompts: string[],
  ) {}

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: [],
      isStreaming: this.streaming,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: 'one-at-a-time',
      sessionId: this.sessionId,
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  async prompt(input: PiAgentPromptInput): Promise<void> {
    const text = typeof input === 'string' ? input : input.text
    this.prompts.push(text)
    this.streaming = true
    this.turn += 1
    const messageId = `pure-smoke-${this.turn}`
    const message = {
      id: messageId,
      role: 'assistant',
      content: [{ type: 'text', text: 'pong' }],
      stopReason: 'end_turn',
    }

    this.emit({ type: 'agent_start' } as AgentSessionEvent)
    this.emit({ type: 'message_start', message } as unknown as AgentSessionEvent)
    this.emit({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'pong' },
    } as unknown as AgentSessionEvent)
    this.emit({ type: 'message_end', message } as unknown as AgentSessionEvent)
    this.streaming = false
    this.emit({ type: 'agent_end', messages: [message], willRetry: false } as unknown as AgentSessionEvent)
  }

  async followUp(): Promise<void> {}

  clearFollowUp(): void {}

  async abort(): Promise<void> {
    this.streaming = false
  }

  private emit(event: AgentSessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }
}
