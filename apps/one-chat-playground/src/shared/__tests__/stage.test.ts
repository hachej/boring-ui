import { describe, expect, it } from 'vitest'

import {
  initialStageState,
  parseStageEvent,
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
  it('starts full while the app is empty', () => {
    expect(initialStageState).toEqual({
      screen: null,
      activity: null,
      mobileChat: { mode: 'full', appReady: false, unseenAssistant: false, questionPending: false },
    })
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

  it('moves button → half → full, then a downward hide returns to button', () => {
    const shown = stageReducer(initialStageState, { type: 'stage.show', what: 'app', url: 'http://localhost:9/' })
    const ready = stageReducer(shown, { type: 'app.ready' })
    expect(ready.mobileChat.mode).toBe('button')
    const half = stageReducer(ready, { type: 'chat.open' })
    expect(half.mobileChat.mode).toBe('half')
    const full = stageReducer(half, { type: 'chat.expand' })
    expect(full.mobileChat.mode).toBe('full')
    expect(stageReducer(full, { type: 'chat.hide' }).mobileChat.mode).toBe('button')
  })

  it('collapses for stage.show and marks a new hidden assistant message unseen', () => {
    const full = stageReducer(initialStageState, { type: 'chat.expand' })
    const shown = stageReducer(full, { type: 'stage.show', what: 'page', url: 'http://localhost:9/sketch' })
    expect(shown.mobileChat.mode).toBe('button')
    const messaged = stageReducer(shown, { type: 'chat.assistant' })
    expect(messaged.mobileChat.unseenAssistant).toBe(true)
    expect(stageReducer(messaged, { type: 'chat.open' }).mobileChat).toMatchObject({
      mode: 'half',
      unseenAssistant: false,
    })
  })

  it('keeps a pending question at least half open until it is answered', () => {
    const button = stageReducer(initialStageState, { type: 'stage.show', what: 'app', url: 'http://localhost:9/' })
    const pending = stageReducer(button, { type: 'chat.question', pending: true })
    expect(pending.mobileChat.mode).toBe('half')
    expect(stageReducer(pending, { type: 'chat.hide' }).mobileChat.mode).toBe('half')
    expect(stageReducer(pending, { type: 'stage.show', what: 'page', url: 'http://localhost:9/sketch' }).mobileChat.mode).toBe('half')
    const answered = stageReducer(pending, { type: 'chat.question', pending: false })
    expect(stageReducer(answered, { type: 'chat.hide' }).mobileChat.mode).toBe('button')
  })

  it('restores phone modes from history without letting Back hide a pending question', () => {
    const shown = stageReducer(initialStageState, { type: 'stage.show', what: 'app', url: 'http://localhost:9/' })
    const ready = stageReducer(shown, { type: 'app.ready' })
    expect(stageReducer(ready, { type: 'chat.history', mode: 'full' }).mobileChat.mode).toBe('full')
    const pending = stageReducer(ready, { type: 'chat.question', pending: true })
    expect(stageReducer(pending, { type: 'chat.history', mode: 'button' }).mobileChat.mode).toBe('half')
  })

  it('ignores unknown events', () => {
    const state: StageState = initialStageState
    expect(stageReducer(state, { type: 'stage.nope' } as never)).toBe(state)
  })
})

describe('parseStageEvent', () => {
  it('accepts well-formed events', () => {
    expect(parseStageEvent({ type: 'stage.clear' })).toEqual({ type: 'stage.clear' })
    expect(parseStageEvent({ type: 'stage.show', what: 'page', url: 'http://localhost:1/', title: 'T' })).toEqual({
      type: 'stage.show',
      what: 'page',
      url: 'http://localhost:1/',
      title: 'T',
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
