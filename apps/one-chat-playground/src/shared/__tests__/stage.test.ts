import { describe, expect, it } from 'vitest'

import {
  chatPresenceReducer,
  createInitialChatPresence,
  firstReplyLine,
  initialStageState,
  parseStageEvent,
  replyNeedsRoom,
  stageReducer,
  type StageState,
} from '../stage.js'
import {
  DEFAULT_ALLOWED_ORIGINS,
  originMatchesPattern,
  parseAllowedOrigins,
  resolveAllowedOriginsFromEnv,
  resolveStageUrl,
} from '../allowedOrigins.js'

describe('stageReducer', () => {
  it('starts without a screen or activity', () => {
    expect(initialStageState).toEqual({ screen: null, activity: null })
  })

  it('raises a sheet on stage.show', () => {
    const next = stageReducer(initialStageState, {
      type: 'stage.show',
      what: 'page',
      url: 'http://127.0.0.1:5321/mockup',
      title: 'New layout',
    })
    expect(next.screen).toEqual({ what: 'page', url: 'http://127.0.0.1:5321/mockup', title: 'New layout' })
  })

  it('keeps the published revision with the preview sheet', () => {
    const next = stageReducer(initialStageState, {
      type: 'stage.show',
      what: 'page',
      url: 'http://localhost:9/sketch',
      title: 'Sketch: invoices',
      label: 'preview',
      revision: 4,
    })
    expect(next.screen).toMatchObject({ label: 'preview', revision: 4 })
  })

  it('defaults the title when the tool omits it', () => {
    const next = stageReducer(initialStageState, { type: 'stage.show', what: 'page', url: 'http://localhost:9/x' })
    expect(next.screen?.title).toBe('Preview')
  })

  it('replaces rather than stacks — only one sheet at a time', () => {
    const first = stageReducer(initialStageState, { type: 'stage.show', what: 'page', url: 'http://localhost:9/a', title: 'A' })
    const second = stageReducer(first, { type: 'stage.show', what: 'page', url: 'http://localhost:9/b', title: 'B' })
    expect(second.screen).toEqual({ what: 'page', url: 'http://localhost:9/b', title: 'B' })
  })

  it('clears back to the base app', () => {
    const shown = stageReducer(initialStageState, { type: 'stage.show', what: 'page', url: 'http://localhost:9/a', title: 'A' })
    expect(stageReducer(shown, { type: 'stage.clear' })).toEqual(initialStageState)
  })

  it('is referentially stable for no-op events', () => {
    const shown = stageReducer(initialStageState, { type: 'stage.show', what: 'page', url: 'http://localhost:9/a', title: 'A' })
    expect(stageReducer(shown, { type: 'stage.show', what: 'page', url: 'http://localhost:9/a', title: 'A' })).toBe(shown)
    expect(stageReducer(initialStageState, { type: 'stage.clear' })).toBe(initialStageState)
  })

  it('ignores an empty url', () => {
    expect(stageReducer(initialStageState, { type: 'stage.show', what: 'page', url: '   ' })).toBe(initialStageState)
  })

  it('tracks builder milestones independently from the stage sheet', () => {
    const started = stageReducer(initialStageState, {
      type: 'activity.started',
      slug: 'invoice-tracker',
      label: 'invoice tracker',
      stage: 'build',
      startedAt: '2026-09-15T12:00:00.000Z',
    })
    expect(started.activity).toMatchObject({ milestone: 'started', stage: 'build' })
    const verifying = stageReducer(started, {
      type: 'activity.verifying',
      slug: 'invoice-tracker',
      label: 'invoice tracker',
      stage: 'build',
      startedAt: '2026-09-15T12:00:00.000Z',
    })
    expect(verifying.activity?.milestone).toBe('verifying')
    const done = stageReducer(verifying, {
      type: 'activity.done',
      slug: 'invoice-tracker',
      label: 'invoice tracker',
      stage: 'build',
      startedAt: '2026-09-15T12:00:00.000Z',
    })
    expect(done.activity?.milestone).toBe('done')
    expect(stageReducer(done, { type: 'activity.clear' })).toEqual(initialStageState)
  })

  it('ignores unknown events', () => {
    const state: StageState = initialStageState
    expect(stageReducer(state, { type: 'stage.nope' } as never)).toBe(state)
  })
})

describe('chatPresenceReducer', () => {
  it('uses bar → window → column on desktop and lets the user move down one rung', () => {
    const empty = createInitialChatPresence('desktop')
    expect(empty.mode).toBe('column')

    const bar = chatPresenceReducer(empty, { type: 'stageShown' })
    expect(bar.mode).toBe('bar')
    const windowed = chatPresenceReducer(bar, { type: 'userExpand' })
    expect(windowed.mode).toBe('window')
    const column = chatPresenceReducer(windowed, { type: 'userExpand' })
    expect(column.mode).toBe('column')
    expect(chatPresenceReducer(column, { type: 'userCollapse' }).mode).toBe('window')
    expect(chatPresenceReducer(windowed, { type: 'userCollapse' }).mode).toBe('bar')
  })

  it('restores a remembered desktop rung when the stage first appears', () => {
    const remembered = createInitialChatPresence('desktop', 'window')
    expect(chatPresenceReducer(remembered, { type: 'stageShown' }).mode).toBe('window')
  })

  it('does not lower a remembered column when a card arrives before the stage', () => {
    const rememberedColumn = createInitialChatPresence('desktop', 'column')
    const pending = chatPresenceReducer(rememberedColumn, { type: 'cardPending', pending: true })
    expect(chatPresenceReducer(pending, { type: 'stageShown' }).mode).toBe('column')

    const newApp = createInitialChatPresence('desktop')
    const newAppPending = chatPresenceReducer(newApp, { type: 'cardPending', pending: true })
    expect(chatPresenceReducer(newAppPending, { type: 'stageShown' }).mode).toBe('window')
  })

  it('lets colleague events nudge desktop chat up but never down', () => {
    const bar = chatPresenceReducer(createInitialChatPresence('desktop'), { type: 'stageShown' })
    const windowed = chatPresenceReducer(bar, { type: 'colleagueNeedsRoom' })
    expect(windowed.mode).toBe('window')
    expect(chatPresenceReducer(windowed, { type: 'colleagueNeedsRoom' })).toBe(windowed)
    const column = chatPresenceReducer(windowed, { type: 'userExpand' })
    expect(chatPresenceReducer(column, { type: 'colleagueNeedsRoom' })).toBe(column)
  })

  it('keeps a pending card in window or column until answered', () => {
    const bar = chatPresenceReducer(createInitialChatPresence('desktop'), { type: 'stageShown' })
    const pending = chatPresenceReducer(bar, { type: 'cardPending', pending: true })
    expect(pending.mode).toBe('window')
    expect(chatPresenceReducer(pending, { type: 'userCollapse' }).mode).toBe('window')

    const column = chatPresenceReducer(pending, { type: 'userExpand' })
    expect(chatPresenceReducer(column, { type: 'userCollapse' }).mode).toBe('window')
    const answered = chatPresenceReducer(pending, { type: 'cardPending', pending: false })
    expect(chatPresenceReducer(answered, { type: 'userCollapse' }).mode).toBe('bar')
  })

  it('replaces a desktop peek, then folds only the current reply into an unseen dot', () => {
    const bar = chatPresenceReducer(createInitialChatPresence('desktop'), { type: 'stageShown' })
    const first = chatPresenceReducer(bar, { type: 'replyArrived', preview: 'First reply' })
    const newest = chatPresenceReducer(first, { type: 'replyArrived', preview: 'Newest reply' })
    expect(newest.peek).toBe('Newest reply')
    expect(chatPresenceReducer(newest, { type: 'peekExpired', replyVersion: first.replyVersion })).toBe(newest)

    const folded = chatPresenceReducer(newest, { type: 'peekExpired', replyVersion: newest.replyVersion })
    expect(folded).toMatchObject({ mode: 'bar', peek: null, unseenAssistant: true })
    expect(chatPresenceReducer(folded, { type: 'userExpand' })).toMatchObject({
      mode: 'window',
      unseenAssistant: false,
    })
  })

  it('keeps the existing phone button → half → full ladder and collapse behavior', () => {
    const full = createInitialChatPresence('phone')
    const button = chatPresenceReducer(full, { type: 'stageShown' })
    expect(button.mode).toBe('button')
    const half = chatPresenceReducer(button, { type: 'userExpand' })
    expect(half.mode).toBe('half')
    const open = chatPresenceReducer(half, { type: 'userExpand' })
    expect(open.mode).toBe('full')
    expect(chatPresenceReducer(open, { type: 'userCollapse' }).mode).toBe('button')
  })

  it('does not let phone history hide a pending card', () => {
    const button = chatPresenceReducer(createInitialChatPresence('phone'), { type: 'stageShown' })
    const pending = chatPresenceReducer(button, { type: 'cardPending', pending: true })
    expect(pending.mode).toBe('half')
    expect(chatPresenceReducer(pending, { type: 'restore', mode: 'button' }).mode).toBe('half')
  })

  it('recognises reply previews and replies that need transcript room', () => {
    expect(firstReplyLine('  Short answer\nMore detail')).toBe('Short answer')
    expect(replyNeedsRoom('Short answer')).toBe(false)
    expect(replyNeedsRoom('Short answer\nMore detail')).toBe(true)
    expect(replyNeedsRoom('x'.repeat(101))).toBe(true)
  })
})

describe('parseStageEvent', () => {
  it('accepts well-formed events', () => {
    expect(parseStageEvent({ type: 'stage.clear' })).toEqual({ type: 'stage.clear' })
    expect(parseStageEvent({ type: 'stage.show', what: 'page', url: 'http://localhost:1/', title: 'T', revision: 2 })).toEqual({
      type: 'stage.show',
      what: 'page',
      url: 'http://localhost:1/',
      title: 'T',
      revision: 2,
    })
  })

  it('accepts activity milestones', () => {
    expect(parseStageEvent({
      type: 'activity.done',
      slug: 'invoice-tracker',
      label: 'invoice tracker',
      stage: 'build',
      startedAt: '2026-09-15T12:00:00.000Z',
    })).toEqual({
      type: 'activity.done',
      slug: 'invoice-tracker',
      label: 'invoice tracker',
      stage: 'build',
      startedAt: '2026-09-15T12:00:00.000Z',
    })
  })

  it('rejects malformed payloads', () => {
    expect(parseStageEvent(null)).toBeNull()
    expect(parseStageEvent('stage.clear')).toBeNull()
    expect(parseStageEvent({ type: 'stage.show' })).toBeNull()
    expect(parseStageEvent({ type: 'stage.show', what: 'page', url: 42 })).toBeNull()
  })
})

describe('resolveStageUrl', () => {
  const origins = [...DEFAULT_ALLOWED_ORIGINS]

  it('allows loopback on any port', () => {
    expect(resolveStageUrl('http://127.0.0.1:5321/clients', origins)).toMatchObject({ ok: true })
    expect(resolveStageUrl('http://localhost:65000/', origins)).toMatchObject({ ok: true })
  })

  it('rejects non-http schemes, credentials, foreign origins and junk', () => {
    expect(resolveStageUrl('file:///etc/passwd', origins)).toMatchObject({ ok: false, reason: 'protocol-not-allowed' })
    expect(resolveStageUrl('javascript:alert(1)', origins)).toMatchObject({ ok: false, reason: 'protocol-not-allowed' })
    expect(resolveStageUrl('http://user:pw@localhost:3000/', origins)).toMatchObject({
      ok: false,
      reason: 'credentials-not-allowed',
    })
    expect(resolveStageUrl('https://evil.example.com/', origins)).toMatchObject({ ok: false, reason: 'origin-not-allowed' })
    expect(resolveStageUrl('not a url', origins)).toMatchObject({ ok: false, reason: 'unparseable' })
    expect(resolveStageUrl('', origins)).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('honours an extended allowlist', () => {
    const extended = [...origins, 'https://preview.example.com']
    expect(resolveStageUrl('https://preview.example.com/deck', extended)).toMatchObject({ ok: true })
    expect(resolveStageUrl('https://other.example.com/deck', extended)).toMatchObject({ ok: false })
  })
})

describe('origin allowlist plumbing', () => {
  it('matches only whole-port wildcards', () => {
    expect(originMatchesPattern('http://localhost:5321', 'http://localhost:*')).toBe(true)
    expect(originMatchesPattern('http://localhost:5321', 'http://localhost')).toBe(false)
    expect(originMatchesPattern('http://sub.localhost:80', 'http://*.localhost:*')).toBe(false)
  })

  it('parses the env list form', () => {
    expect(parseAllowedOrigins('https://a.test, https://b.test')).toEqual(['https://a.test', 'https://b.test'])
    expect(parseAllowedOrigins(undefined)).toEqual([])
  })

  it('extends the defaults from ONE_CHAT_ALLOWED_ORIGINS', () => {
    expect(resolveAllowedOriginsFromEnv({ ONE_CHAT_ALLOWED_ORIGINS: 'https://a.test' } as NodeJS.ProcessEnv)).toEqual([
      ...DEFAULT_ALLOWED_ORIGINS,
      'https://a.test',
    ])
    expect(resolveAllowedOriginsFromEnv({} as NodeJS.ProcessEnv)).toEqual([...DEFAULT_ALLOWED_ORIGINS])
  })
})
