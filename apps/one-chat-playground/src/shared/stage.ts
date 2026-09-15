/**
 * Host-driven screen state plus the existing phone chat-sheet state. The screen
 * begins absent: chat is home until the colleague deliberately shows an app or
 * preview through the stage bus.
 */

export type StageScreenKind = 'app' | 'page'

export interface StageScreen {
  readonly what: StageScreenKind
  readonly url: string
  readonly title: string
}

export type BuilderActivityStage = 'mockup' | 'build'
export type BuilderActivityMilestone = 'started' | 'verifying' | 'done'

export interface BuilderActivity {
  readonly slug: string
  readonly label: string
  readonly stage: BuilderActivityStage
  readonly milestone: BuilderActivityMilestone
  readonly startedAt: string
}

export type MobileChatMode = 'button' | 'half' | 'full'

export interface MobileChatState {
  readonly mode: MobileChatMode
  readonly appReady: boolean
  readonly unseenAssistant: boolean
  readonly questionPending: boolean
}

export interface StageState {
  /** Null means chat owns the available space. */
  readonly screen: StageScreen | null
  readonly activity: BuilderActivity | null
  readonly mobileChat: MobileChatState
}

export type StageEvent =
  | { readonly type: 'stage.show'; readonly what: StageScreenKind; readonly url: string; readonly title?: string }
  | { readonly type: 'stage.clear' }
  | ({ readonly type: 'activity.started' } & Omit<BuilderActivity, 'milestone'>)
  | ({ readonly type: 'activity.verifying' | 'activity.done' } & Omit<BuilderActivity, 'milestone'>)
  | { readonly type: 'activity.clear' }
  | { readonly type: 'app.ready' }
  | { readonly type: 'chat.open' | 'chat.expand' | 'chat.hide' | 'chat.assistant' }
  | { readonly type: 'chat.question'; readonly pending: boolean }
  | { readonly type: 'chat.history'; readonly mode: MobileChatMode }

export const STAGE_EVENT_TYPES = [
  'stage.show',
  'stage.clear',
  'activity.started',
  'activity.verifying',
  'activity.done',
  'activity.clear',
] as const

export const initialStageState: StageState = {
  screen: null,
  activity: null,
  mobileChat: { mode: 'full', appReady: false, unseenAssistant: false, questionPending: false },
}

function hiddenChatMode(state: StageState): MobileChatMode {
  if (!state.screen) return 'full'
  return state.mobileChat.questionPending ? 'half' : 'button'
}

export function stageReducer(state: StageState, event: StageEvent): StageState {
  switch (event.type) {
    case 'stage.show': {
      const url = event.url.trim()
      if (!url) return state
      const title = event.title?.trim() || (event.what === 'app' ? 'Your app' : 'Preview')
      const screen = { what: event.what, url, title } as const
      const mode = state.mobileChat.questionPending
        ? (state.mobileChat.mode === 'full' ? 'full' : 'half')
        : 'button'
      if (
        state.screen?.what === screen.what
        && state.screen.url === screen.url
        && state.screen.title === screen.title
        && state.mobileChat.mode === mode
      ) return state
      return { ...state, screen, mobileChat: { ...state.mobileChat, mode } }
    }
    case 'stage.clear':
      if (state.screen === null && state.mobileChat.mode === 'full') return state
      return {
        ...state,
        screen: null,
        mobileChat: { ...state.mobileChat, mode: 'full', appReady: false, unseenAssistant: false },
      }
    case 'activity.started':
    case 'activity.verifying':
    case 'activity.done': {
      const milestone = event.type.slice('activity.'.length) as BuilderActivityMilestone
      const activity = {
        slug: event.slug,
        label: event.label,
        stage: event.stage,
        milestone,
        startedAt: event.startedAt,
      }
      if (JSON.stringify(state.activity) === JSON.stringify(activity)) return state
      return { ...state, activity }
    }
    case 'activity.clear':
      return state.activity === null ? state : { ...state, activity: null }
    case 'app.ready':
      if (state.mobileChat.appReady) return state
      return {
        ...state,
        mobileChat: { ...state.mobileChat, appReady: true, mode: hiddenChatMode(state) },
      }
    case 'chat.open':
      if (!state.screen) return state
      if (state.mobileChat.mode !== 'button' && !state.mobileChat.unseenAssistant) return state
      return { ...state, mobileChat: { ...state.mobileChat, mode: 'half', unseenAssistant: false } }
    case 'chat.expand':
      if (state.mobileChat.mode === 'full' && !state.mobileChat.unseenAssistant) return state
      return { ...state, mobileChat: { ...state.mobileChat, mode: 'full', unseenAssistant: false } }
    case 'chat.hide': {
      const mode = hiddenChatMode(state)
      if (state.mobileChat.mode === mode) return state
      return { ...state, mobileChat: { ...state.mobileChat, mode } }
    }
    case 'chat.assistant':
      if (state.mobileChat.mode !== 'button' || state.mobileChat.unseenAssistant) return state
      return { ...state, mobileChat: { ...state.mobileChat, unseenAssistant: true } }
    case 'chat.question': {
      const mode = event.pending && state.mobileChat.mode === 'button' ? 'half' : state.mobileChat.mode
      if (state.mobileChat.questionPending === event.pending && mode === state.mobileChat.mode) return state
      return {
        ...state,
        mobileChat: {
          ...state.mobileChat,
          questionPending: event.pending,
          mode,
          ...(event.pending ? { unseenAssistant: false } : {}),
        },
      }
    }
    case 'chat.history': {
      const requested = state.screen ? event.mode : 'full'
      const mode = state.mobileChat.questionPending && requested === 'button' ? 'half' : requested
      if (state.mobileChat.mode === mode && (mode === 'button' || !state.mobileChat.unseenAssistant)) return state
      return {
        ...state,
        mobileChat: { ...state.mobileChat, mode, unseenAssistant: mode === 'button' && state.mobileChat.unseenAssistant },
      }
    }
    default:
      return state
  }
}

/** Narrow unknown SSE payloads; malformed frames never change UI state. */
export function parseStageEvent(raw: unknown): StageEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.type === 'stage.clear') return { type: 'stage.clear' }
  if (candidate.type === 'activity.clear') return { type: 'activity.clear' }
  if (
    candidate.type === 'stage.show'
    && (candidate.what === 'app' || candidate.what === 'page')
    && typeof candidate.url === 'string'
  ) {
    return {
      type: 'stage.show',
      what: candidate.what,
      url: candidate.url,
      ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}),
    }
  }
  if (
    (candidate.type === 'activity.started' || candidate.type === 'activity.verifying' || candidate.type === 'activity.done')
    && typeof candidate.slug === 'string'
    && typeof candidate.label === 'string'
    && (candidate.stage === 'mockup' || candidate.stage === 'build')
    && typeof candidate.startedAt === 'string'
    && !Number.isNaN(Date.parse(candidate.startedAt))
  ) {
    return {
      type: candidate.type,
      slug: candidate.slug,
      label: candidate.label,
      stage: candidate.stage,
      startedAt: candidate.startedAt,
    }
  }
  return null
}
