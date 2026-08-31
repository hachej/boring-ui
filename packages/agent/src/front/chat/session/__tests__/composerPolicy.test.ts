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
import type { ActiveSessionStorageLike } from '../sessionSelectionStorage'

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

  it('accepts a handled pre-submit result without invoking the agent', async () => {
    const session = new FakeComposerSession('idle')
    const onCommandResult = vi.fn()
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      onBeforeSubmit: vi.fn(async () => ({
        handled: true as const,
        message: 'Context stored.',
      })),
      onCommandResult,
    })

    await expect(policy.submit({ text: 'large context' })).resolves.toEqual({
      type: 'handled',
      message: 'Context stored.',
      preserveDraft: false,
    })
    expect(session.prompts).toEqual([])
    expect(session.followUps).toEqual([])
    expect(onCommandResult).not.toHaveBeenCalled()
  })

  it('replaces model-facing and display text after asynchronous pre-submit work', async () => {
    const session = new FakeComposerSession('idle')
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      createClientNonce: nonceFactory(),
      onBeforeSubmit: vi.fn(async () => ({
        replacement: {
          text: '[stored-context artifact=ctx-123]',
          displayText: 'Clinical context stored',
        },
      })),
    })

    await expect(policy.submit({ text: 'the large raw context' })).resolves.toMatchObject({
      type: 'prompt',
      preserveDraft: false,
    })
    expect(session.prompts).toEqual([expect.objectContaining({
      message: '[stored-context artifact=ctx-123]',
      displayMessage: 'Clinical context stored',
    })])
  })

  it('treats replacement text as final model payload rather than local command syntax', async () => {
    const reset = vi.fn()
    const registry = createCommandRegistry(builtinCommands)
    registry.register({ name: 'review', description: 'Review', kind: 'skill', handler: vi.fn() })
    const session = new FakeComposerSession('idle')
    const replacements = ['/reset', '/review source.ts']
    const policy = createPiComposerPolicyController({
      session,
      registry,
      slashContext: context({ resetSession: reset }),
      createClientNonce: nonceFactory(),
      onBeforeSubmit: vi.fn(async () => ({ replacement: { text: replacements.shift()! } })),
    })

    await policy.submit({ text: 'first raw input' })
    await policy.submit({ text: 'second raw input' })

    expect(reset).not.toHaveBeenCalled()
    expect(session.prompts.map((prompt) => prompt.message)).toEqual(['/reset', '/review source.ts'])
  })

  it('rejects an asynchronous pre-submit result after the active session changes', async () => {
    const session = new FakeComposerSession('idle')
    let active = true
    const onWarning = vi.fn()
    let finish!: (value: { handled: true; message: string }) => void
    const beforeSubmit = new Promise<{ handled: true; message: string }>((resolve) => { finish = resolve })
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      isActiveSession: () => active,
      onBeforeSubmit: async () => await beforeSubmit,
      onWarning,
    })

    const pending = policy.submit({ text: 'large context' })
    active = false
    finish({ handled: true, message: 'Context stored.' })

    await expect(pending).resolves.toEqual({
      type: 'stale',
      reason: 'inactive-session',
      preserveDraft: false,
    })
    expect(session.prompts).toEqual([])
    expect(onWarning).not.toHaveBeenCalled()
  })

  it('converts a rejected pre-submit hook to stale after the active session changes', async () => {
    const session = new FakeComposerSession('idle')
    let active = true
    let fail!: (error: Error) => void
    const beforeSubmit = new Promise<never>((_resolve, reject) => { fail = reject })
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      isActiveSession: () => active,
      onBeforeSubmit: async () => await beforeSubmit,
    })

    const pending = policy.submit({ text: 'large context' })
    active = false
    fail(new Error('upload failed'))

    await expect(pending).resolves.toEqual({
      type: 'stale',
      reason: 'inactive-session',
      preserveDraft: false,
    })
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

  it('serializes asynchronous final prompt transforms in submission order', async () => {
    const session = new FakeComposerSession('idle')
    const releases: Array<() => void> = []
    const transformed: string[] = []
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      createClientNonce: nonceFactory(),
      onTransformPrompt: async (text) => {
        transformed.push(text)
        await new Promise<void>((resolve) => releases.push(resolve))
        return { replacement: { text: `stored:${text}` } }
      },
    })

    const first = policy.submit({ text: 'first' })
    const second = policy.submit({ text: 'second' })
    await vi.waitFor(() => expect(transformed).toEqual(['first']))
    releases.shift()?.()
    await expect(first).resolves.toMatchObject({ type: 'prompt' })
    await vi.waitFor(() => expect(transformed).toEqual(['first', 'second']))
    releases.shift()?.()
    await expect(second).resolves.toMatchObject({ type: 'prompt' })
    expect(session.prompts.map((prompt) => prompt.message)).toEqual(['stored:first', 'stored:second'])
  })

  it('treats a true host pre-submit result as allow and still transforms final text', async () => {
    const session = new FakeComposerSession('idle')
    const transform = vi.fn(async () => ({ replacement: { text: 'stored prompt' } }))
    const policy = createPiComposerPolicyController({
      session,
      registry: createCommandRegistry(builtinCommands),
      slashContext: context(),
      onBeforeSubmit: () => true,
      onTransformPrompt: transform,
    })

    await expect(policy.submit({ text: 'x'.repeat(20) })).resolves.toMatchObject({ type: 'prompt' })
    expect(transform).toHaveBeenCalledWith('x'.repeat(20), expect.objectContaining({ source: 'composer' }))
    expect(session.prompts[0]?.message).toBe('stored prompt')
  })

  it('expands skill slash commands before transforming oversized model-bound text', async () => {
    const session = new FakeComposerSession('idle')
    const registry = createCommandRegistry(builtinCommands)
    registry.register({ name: 'review', description: 'Review diff', kind: 'skill', handler: vi.fn() })
    const transform = vi.fn(async () => ({ replacement: { text: 'stored skill prompt', displayText: 'Large skill input saved' } }))
    const policy = createPiComposerPolicyController({
      session,
      registry,
      slashContext: context({ listCommands: () => registry.list() }),
      onTransformPrompt: transform,
    })

    await expect(policy.submit({ text: `/review ${'x'.repeat(20)}` })).resolves.toMatchObject({ type: 'prompt' })
    expect(transform).toHaveBeenCalledWith(`skill: review\n\n${'x'.repeat(20)}`, expect.any(Object))
    expect(session.prompts[0]).toMatchObject({
      message: 'stored skill prompt',
      displayMessage: 'Large skill input saved',
    })
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

  it('sends a local command result the agent must see into the transcript with full prompt bookkeeping', async () => {
    const session = new FakeComposerSession('idle')
    const registry = createCommandRegistry(builtinCommands)
    const onCommandResult = vi.fn()
    const run = vi.fn(async () => 'Extensions reloaded.')
    const policy = createPiComposerPolicyController({
      session,
      registry,
      slashContext: context({ pluginUpdate: { run } }),
      createClientNonce: nonceFactory(),
      onCommandResult,
    })

    // The admitted model-facing run returns its real receipt so callers can do
    // prompt bookkeeping (clientNonce/cursor), exactly like a plain prompt.
    await expect(policy.submit({ text: '/reload' })).resolves.toEqual({
      type: 'prompt',
      clientNonce: 'nonce-1',
      cursor: expect.any(Number),
      preserveDraft: false,
    })
    // The browser notice still fires as a side effect, and the same outcome
    // reaches the model.
    expect(onCommandResult).toHaveBeenCalledWith('Extensions reloaded.')
    expect(session.prompts).toHaveLength(1)
    expect(session.prompts[0]?.message).toBe('/reload result:\nExtensions reloaded.')
  })

  it('makes a failed reload the message the agent receives', async () => {
    const session = new FakeComposerSession('idle')
    const registry = createCommandRegistry(builtinCommands)
    const policy = createPiComposerPolicyController({
      session,
      registry,
      slashContext: context({ pluginUpdate: { run: vi.fn(async () => 'Extension update failed: worker unreachable') } }),
      createClientNonce: nonceFactory(),
    })

    await policy.submit({ text: '/reload' })
    expect(session.prompts[0]?.message).toBe('/reload result:\nExtension update failed: worker unreachable')
  })

  it('leaves commands without a model-facing result out of the transcript', async () => {
    const session = new FakeComposerSession('idle')
    const registry = createCommandRegistry(builtinCommands)
    registry.register({ name: 'note', description: 'UI only', handler: () => 'noted' })
    const policy = createPiComposerPolicyController({
      session,
      registry,
      slashContext: context({ listCommands: () => registry.list() }),
      createClientNonce: nonceFactory(),
    })

    await expect(policy.submit({ text: '/note' })).resolves.toMatchObject({ type: 'command', result: 'noted' })
    expect(session.prompts).toHaveLength(0)
    expect(session.followUps).toHaveLength(0)
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
