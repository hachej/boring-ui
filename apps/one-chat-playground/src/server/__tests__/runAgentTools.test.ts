import { afterEach, describe, expect, test } from 'vitest'
import type { AgentGateway, AgentSessionConnection, AgentTool, AuthorizedAgentScope } from '@hachej/boring-agent/shared'

import { agreeIntent, openIntent, readIntent } from '../memoryFiles'
import { createSessionTracker } from '../reloadTools'
import { createRunAgentTools, defaultBuilderStage } from '../runAgentTools'
import { createStageBus } from '../stageBus'
import { workspaceFixture } from './workspaceFixture'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

function resultText(result: Awaited<ReturnType<AgentTool['execute']>>): string {
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
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
    const bundle = await workspaceFixture('one-chat-builder-')
    disposers.push(bundle.disposeRuntime ?? (async () => {}))
    const workspace = bundle.workspace
    await openIntent(workspace, 'suppliers', 'I need suppliers.')
    await agreeIntent(workspace, 'suppliers', 'A supplier list.')
    const tracker = createSessionTracker()
    tracker.remember('live-colleague')

    let releaseBuilder!: () => void
    const builderGate = new Promise<void>((resolve) => {
      releaseBuilder = resolve
    })
    const prompts: Array<{ agentTypeId: string; content: string }> = []
    const scope = {
      workspaceScopeId: 'workspace',
      authSubjectId: 'user',
    } as AuthorizedAgentScope
    const gateway = {
      async createSession(input: { agentTypeId: string }) {
        return {
          agentTypeId: input.agentTypeId,
          sessionId: `${input.agentTypeId}-session`,
        }
      },
      async readSessionState(input: { ref: { agentTypeId: string; sessionId: string } }) {
        return {
          ref: input.ref,
          seq: 0,
          summary: { status: 'idle' },
          state: { messages: [] },
        }
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
                final: {
                  id: 'answer',
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'Suppliers can now be listed.' }],
                },
              },
            }
            yield {
              ref,
              seq: 2,
              event: {
                type: 'agent-end',
                seq: 2,
                turnId: 'turn',
                status: 'ok',
              },
            }
          })(),
          async send(input: { content: string }) {
            prompts.push({
              agentTypeId: ref.agentTypeId,
              content: input.content,
            })
            return {
              accepted: true,
              disposition: 'prompt',
              clientNonce: 'nonce',
            }
          },
          async close() {},
        }
        return connection as unknown as AgentSessionConnection
      },
    } as unknown as AgentGateway

    const activityBus = createStageBus()
    const activityEvents: string[] = []
    const activityLabels: string[] = []
    activityBus.subscribe((event) => {
      if (event.type.startsWith('activity.')) activityEvents.push(event.type)
      if (event.type === 'activity.started') activityLabels.push(event.label)
    })
    const tools = createRunAgentTools({
      workspace,
      scope,
      getGateway: () => gateway,
      sessions: tracker,
      activityBus,
    })
    const runBuilder = tools.find((tool) => tool.name === 'run_builder')!
    const first = await runBuilder.execute({ slug: 'suppliers', stage: 'build' }, { sessionId: 'live-colleague' } as never)
    expect(resultText(first)).toBe('started build')
    expect((await readIntent(workspace, 'suppliers'))?.status).toBe('building')
    expect(activityEvents).toEqual(['activity.started'])
    expect(activityLabels).toEqual(['supplier list'])

    const second = await runBuilder.execute({ slug: 'suppliers', stage: 'mockup' }, { sessionId: 'live-colleague' } as never)
    expect(resultText(second)).toBe('a builder is already running')

    releaseBuilder()
    await poll(async () => (await readIntent(workspace, 'suppliers'))?.status === 'built')
    const intent = await readIntent(workspace, 'suppliers')
    expect(intent?.body).toContain('Builder build: Suppliers can now be listed.')
    expect(activityEvents).toEqual(['activity.started', 'activity.verifying', 'activity.done'])
    expect(prompts).toContainEqual({
      agentTypeId: 'builder',
      content: 'BUILD intent suppliers in this isolated candidate. Match public/mockups/suppliers.html when it exists and write one smoke check per agreement shall-line.',
    })
    expect(prompts.find((entry) => entry.agentTypeId === 'default')?.content).toBe(
      '[system event] The builder finished intent suppliers: Suppliers can now be listed. The verified preview is already on screen at "/" titled "Preview: supplier list". Say it is a preview where nothing is saved, then ask whether to keep it, change something, or leave it as it was.',
    )
  })

  test('shows a historical version from the lifecycle tool catalog', async () => {
    const bundle = await workspaceFixture('one-chat-version-')
    disposers.push(bundle.disposeRuntime ?? (async () => {}))
    const activityBus = createStageBus()
    const events: unknown[] = []
    activityBus.subscribe((event) => events.push(event))
    const tools = createRunAgentTools({
      workspace: bundle.workspace,
      scope: { workspaceScopeId: 'workspace', authSubjectId: 'user' } as AuthorizedAgentScope,
      getGateway: () => { throw new Error('unused') },
      sessions: createSessionTracker(),
      activityBus,
      lifecycle: {
        showVersion: async () => ({
          url: 'http://localhost:6101/',
          title: 'Kept version abc123',
          label: 'abc123 · suppliers',
          commit: 'abc123',
        }),
      } as never,
    })

    const result = await tools.find((candidate) => candidate.name === 'show_version')!.execute(
      { commit: 'abc123' },
      {} as never,
    )

    expect(resultText(result)).toContain('Nothing you do there is saved')
    expect(events).toContainEqual({
      type: 'stage.show',
      what: 'page',
      url: 'http://localhost:6101/',
      title: 'Previous version',
      label: 'version',
      versionLabel: 'abc123 · suppliers',
    })
  })

  test('defaults new surfaces to mockup until an intent has build history', () => {
    expect(
      defaultBuilderStage({
        status: 'agreed',
        body: '',
        agreement: 'A new supplier list on one page.',
      }),
    ).toBe('mockup')
    expect(
      defaultBuilderStage({
        status: 'sketched',
        body: 'The sketch was accepted.',
        agreement: 'A new supplier list on one page.',
      }),
    ).toBe('mockup')
    expect(
      defaultBuilderStage({
        status: 'agreed',
        body: '- 2026-09-15 10:00 — Builder build: Suppliers can now be listed.',
        agreement: 'A new supplier list on one page.',
      }),
    ).toBe('build')
    expect(
      defaultBuilderStage({
        status: 'kept',
        body: '',
        agreement: 'A new supplier list on one page.',
      }),
    ).toBe('build')
    expect(
      defaultBuilderStage({
        status: 'agreed',
        body: '',
        agreement: 'Make the add button red.',
      }),
    ).toBe('build')
  })
})
