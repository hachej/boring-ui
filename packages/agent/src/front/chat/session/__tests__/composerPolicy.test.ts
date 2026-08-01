import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileUIPart } from 'ai'
import type { BoringChatMessage, FollowUpPayload, PiChatStatus, PromptPayload, QueuedUserMessage } from '../../../../shared/chat'
import { createInitialPiChatState, type PiChatState } from '../../pi/piChatReducer'
import type { PiQueueSessionLike } from '../../pi/piFollowUpQueueController'
import { createCommandRegistry, type SlashCommandContext } from '../../../slashCommands/registry'
import { builtinCommands } from '../../../slashCommands/builtins'
import {
  buildPromptPolicyPayload,
  createPiComposerPolicyController,
  InitialDraftAutoSubmitGuard,
  readPiComposerSettings,
  scopedComposerStorageKey,
  selectComposerHistoryFromCanonicalUsers,
  skillCommandText,
  writePiComposerModelSelection,
  writePiComposerShowThoughts,
  writePiComposerThinking,
} from '../composerPolicy'
import type { ActiveSessionStorageLike } from '../activeSessionStorage'

class FakeComposerSession implements PiQueueSessionLike {
  state: PiChatState
  prompts: PromptPayload[] = []
  followUps: FollowUpPayload[] = []
  clearQueue = vi.fn(async () => ({ accepted: true as const, cursor: 1, cleared: this.state.queue.followUps.length }))
  interrupt = vi.fn(async () => ({ accepted: true as const, cursor: 2 }))
  stop = vi.fn(async () => ({ accepted: true as const, cursor: 3, stopped: true as const, clearedQueue: this.state.queue.followUps }))

  constructor(status: PiChatStatus, followUps: QueuedUserMessage[] = []) {
    this.state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope', status })
    this.state = { ...this.state, queue: { followUps } }
  }

  getState(): PiChatState {
    return this.state
  }

  async prompt(payload: PromptPayload) {
    this.prompts.push(payload)
    return { accepted: true as const, cursor: 10, clientNonce: payload.clientNonce }
  }

  async followUp(payload: FollowUpPayload) {
    this.followUps.push(payload)
    return { accepted: true as const, cursor: 11, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true as const }
  }
}

function storage(initial: Record<string, string> = {}): ActiveSessionStorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

function context(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    sessionId: 's1',
    clearMessages: vi.fn(),
    resetSession: vi.fn(),
    listCommands: vi.fn(() => builtinCommands),
    reloadAgentPlugins: vi.fn(async () => 'Agent plugins reloaded.'),
    ...overrides,
  }
}

function nonceFactory() {
  let index = 0
  return () => `nonce-${++index}`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Pi composer v2 settings', () => {
  it('persists model, thinking, and thought visibility under opaque storageScope v2 keys', () => {
    const store = storage()
    writePiComposerModelSelection({ provider: 'anthropic', id: 'claude-sonnet' }, { storageScope: 'tenant-a', storage: store })
    writePiComposerThinking('high', { storageScope: 'tenant-a', storage: store })
    writePiComposerShowThoughts(true, { storageScope: 'tenant-a', storage: store })

    expect(store.values.get(scopedComposerStorageKey('tenant-a', 'model'))).toBe(JSON.stringify({ provider: 'anthropic', id: 'claude-sonnet' }))
    expect(store.values.get(scopedComposerStorageKey('tenant-a', 'model:user-selected'))).toBe('1')
    expect(store.values.get(scopedComposerStorageKey('tenant-a', 'thinking'))).toBe('high')
    expect(store.values.get(scopedComposerStorageKey('tenant-a', 'show-thoughts'))).toBe('1')
    expect(readPiComposerSettings({ storageScope: 'tenant-a', storage: store })).toEqual({
      model: { provider: 'anthropic', id: 'claude-sonnet' },
      userSelectedModel: true,
      thinkingLevel: 'high',
      showThoughts: true,
    })
    expect(readPiComposerSettings({ storageScope: 'tenant-b', storage: store }).model).toBeNull()
  })

  it('includes selected model and thinkingLevel in prompt payload only when opted in', () => {
    expect(buildPromptPolicyPayload({
      message: 'hello',
      clientNonce: 'nonce-1',
      model: { provider: 'anthropic', id: 'claude' },
      thinkingLevel: 'medium',
      thinkingControl: true,
      attachments: [{ filename: 'spec.md', mediaType: 'text/markdown', url: '/files/spec.md' }],
    })).toEqual({
      message: 'hello',
      clientNonce: 'nonce-1',
      model: { provider: 'anthropic', id: 'claude' },
      thinkingLevel: 'medium',
      attachments: [{ filename: 'spec.md', mediaType: 'text/markdown', url: '/files/spec.md' }],
    })

    expect(buildPromptPolicyPayload({ message: 'hello', clientNonce: 'nonce-1', thinkingLevel: 'high', thinkingControl: false })).toEqual({
      message: 'hello',
      clientNonce: 'nonce-1',
    })
  })
})

describe('PiComposerPolicyController submit policy', () => {
  it('sends idle text through prompt with model/thinking and enriched attachment payload', async () => {
    const session = new FakeComposerSession('idle')
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      createClientNonce: nonceFactory(),
      model: { provider: 'anthropic', id: 'claude' },
      thinkingLevel: 'medium',
      thinkingControl: true,
      mentionedFiles: ['src/app.ts'],
      onMentionedFilesConsumed: vi.fn(),
    })
    const file = { type: 'file', filename: 'spec.md', mediaType: 'text/markdown', url: 'https://files.test/spec.md' } as FileUIPart
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('# Spec'))

    await expect(policy.submit({ text: 'Build it', files: [file] })).resolves.toMatchObject({ type: 'prompt', clientNonce: 'nonce-1' })

    expect(session.prompts).toEqual([expect.objectContaining({
      clientNonce: 'nonce-1',
      model: { provider: 'anthropic', id: 'claude' },
      thinkingLevel: 'medium',
      attachments: [{ filename: 'spec.md', mediaType: 'text/markdown', url: 'https://files.test/spec.md' }],
    })])
    expect(session.prompts[0]?.message).toContain('Build it')
    expect(session.prompts[0]?.message).toContain('<attachment data-boring-agent="composer-file" filename="spec.md" mime="text/markdown">')
    expect(session.prompts[0]?.message).toContain('@files: src/app.ts')
    expect(session.prompts[0]?.displayMessage).toBe('Build it')
  })

  it('allows the first prompt while an empty initial session is still hydrating', async () => {
    const session = new FakeComposerSession('hydrating')
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      createClientNonce: nonceFactory(),
      allowPromptDuringInitialHydration: true,
    })

    await expect(policy.submit({ text: 'first message' })).resolves.toMatchObject({
      type: 'prompt',
      clientNonce: 'nonce-1',
      preserveDraft: false,
    })
    expect(session.prompts).toEqual([expect.objectContaining({ message: 'first message', clientNonce: 'nonce-1' })])
  })

  it('blocks another prompt while the first hydrating prompt is still optimistic', async () => {
    const session = new FakeComposerSession('idle')
    session.state = {
      ...session.state,
      hydrated: true,
      optimisticOutbox: {
        'nonce-first': {
          id: 'optimistic:nonce-first',
          role: 'user',
          status: 'pending',
          clientNonce: 'nonce-first',
          parts: [{ type: 'text', text: 'first message' }],
        },
      },
    }
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
    })

    await expect(policy.submit({ text: 'second message' })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'hydrating',
      preserveDraft: true,
    })
    expect(session.prompts).toEqual([])
  })

  it('keeps blocking submit while a non-empty session is hydrating', async () => {
    const session = new FakeComposerSession('hydrating')
    session.state = { ...session.state, history: { mode: 'full', messageCount: 1 } }
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
    })

    await expect(policy.submit({ text: 'too soon' })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'hydrating',
      preserveDraft: true,
    })
    expect(session.prompts).toEqual([])
  })

  it('does not consume mentioned files when the remote prompt fails before acceptance', async () => {
    const session = new FakeComposerSession('idle')
    session.prompt = vi.fn(async (payload: PromptPayload) => {
      session.prompts.push(payload)
      throw new Error('network down')
    })
    const consumed = vi.fn()
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      mentionedFiles: ['src/app.ts'],
      onMentionedFilesConsumed: consumed,
    })

    await expect(policy.submit({ text: 'retry me' })).rejects.toThrow('network down')

    expect(session.prompts[0]).toMatchObject({
      message: 'retry me\n\n@files: src/app.ts',
      displayMessage: 'retry me',
    })
    expect(consumed).not.toHaveBeenCalled()
  })

  it('preserves draft when warmup/blockers or pre-submit cancellation block submission', async () => {
    const warnings: string[] = []
    const session = new FakeComposerSession('idle')
    const blocked = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      composerBlocked: true,
      blockerMessage: 'Preparing workspace…',
      onWarning: (message) => warnings.push(message),
    })
    await expect(blocked.submit({ text: 'keep me' })).resolves.toEqual({
      type: 'blocked',
      reason: 'composer-blocked',
      message: 'Preparing workspace…',
      preserveDraft: true,
    })

    const cancelled = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      onBeforeSubmit: vi.fn(async () => false),
    })
    await expect(cancelled.submit({ text: 'still keep me' })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'pre-submit-cancelled',
      preserveDraft: true,
    })
    expect(session.prompts).toEqual([])
    expect(warnings).toEqual(['Preparing workspace…'])
  })

  it('runs local slash commands when idle and blocks executable slash while streaming', async () => {
    const reset = vi.fn()
    const idlePolicy = createPiComposerPolicyController({
      session: new FakeComposerSession('idle'),
      registry: createCommandRegistry(builtinCommands),
      slashContext: context({ resetSession: reset }),
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
    await expect(idlePolicy.submit({ text: '/reset' })).resolves.toMatchObject({ type: 'command', command: 'reset', result: 'Session reset.' })
    expect(reset).toHaveBeenCalledTimes(1)

    const streamingPolicy = createPiComposerPolicyController({
      session: new FakeComposerSession('streaming'),
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
    })
    await expect(streamingPolicy.submit({ text: '/reload' })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'busy-slash-command',
      preserveDraft: true,
    })

    const control = vi.fn(() => 'controlled')
    const controlRegistry = createCommandRegistry([{
      name: 'live',
      description: 'Live transcript controls',
      allowWhileBusy: (args) => args.trim() === 'stop' || args.trim() === 'status',
      handler: control,
    }])
    const controlPolicy = createPiComposerPolicyController({
      session: new FakeComposerSession('streaming'),
      registry: controlRegistry,
      slashContext: context(),
    })
    await expect(controlPolicy.submit({ text: '/live stop' })).resolves.toMatchObject({ type: 'command', result: 'controlled' })
    await expect(controlPolicy.submit({ text: '/live start' })).resolves.toMatchObject({ type: 'blocked', reason: 'busy-slash-command' })
    expect(control).toHaveBeenCalledTimes(1)
  })

  it('expands skill slash commands to Pi text so streaming follow-up queueing is explicit and safe', async () => {
    const session = new FakeComposerSession('streaming')
    const registry = createCommandRegistry(builtinCommands)
    registry.register({ name: 'review', description: 'Review diff', kind: 'skill', handler: vi.fn() })
    const beforeSubmit = vi.fn(async () => true)
    const policy = createPiComposerPolicyController({
      session,
      registry,
      slashContext: context({ listCommands: () => registry.list() }),
      createClientNonce: nonceFactory(),
      onBeforeSubmit: beforeSubmit,
    })

    await expect(policy.submit({ text: '/review src/app.ts' })).resolves.toEqual({
      type: 'followup',
      clientNonce: 'nonce-1',
      clientSeq: 1,
      cursor: 11,
      preserveDraft: false,
    })
    expect(session.followUps).toEqual([{ message: 'skill: review\n\nsrc/app.ts', clientNonce: 'nonce-1', clientSeq: 1 }])
    expect(beforeSubmit).toHaveBeenCalledTimes(1)
    expect(skillCommandText('review', 'src/app.ts')).toBe('skill: review\n\nsrc/app.ts')
  })

  it('blocks busy attachments before attachment enrichment work starts', async () => {
    const session = new FakeComposerSession('streaming')
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(policy.submit({
      text: 'queued with file',
      files: [{ type: 'file', filename: 'spec.md', mediaType: 'text/markdown', url: 'https://files.test/spec.md' } as FileUIPart],
    })).resolves.toMatchObject({ type: 'blocked', reason: 'busy-attachments', preserveDraft: true })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(session.followUps).toEqual([])
  })
})

describe('composer history and initialDraft guards', () => {
  it('uses canonical user messages only for composer history', () => {
    const messages: BoringChatMessage[] = [
      { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:text', text: 'canonical one' }] },
      { id: 'optimistic', role: 'user', status: 'pending', clientNonce: 'n1', parts: [{ type: 'text', text: 'browser only' }] },
      { id: 'a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'a1:text', text: 'nope' }] },
    ]

    expect(selectComposerHistoryFromCanonicalUsers(messages)).toEqual(['canonical one'])
  })

  it('restores and auto-submits an initial draft only once per active session/draft pair', () => {
    const guard = new InitialDraftAutoSubmitGuard()

    expect(guard.shouldRestore('s1', 'draft')).toBe(true)
    expect(guard.shouldRestore('s1', 'draft')).toBe(false)
    expect(guard.shouldRestore('s2', 'draft')).toBe(true)

    expect(guard.claimAutoSubmit('s1', 'draft')).toBe(true)
    expect(guard.claimAutoSubmit('s1', 'draft')).toBe(false)
    expect(guard.claimAutoSubmit('s1', 'changed')).toBe(false)
    expect(guard.claimAutoSubmit('s2', 'changed')).toBe(true)
    expect(guard.claimAutoSubmit('s3', '   ')).toBe(false)
  })
})
