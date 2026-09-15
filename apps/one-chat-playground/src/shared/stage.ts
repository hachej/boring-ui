/**
 * The stage is the right-hand half of "One Chat, One Screen": a base iframe
 * showing the user's app, and at most one overlay sheet the agent can raise
 * over it. Server stage/activity events and local phone-sheet transitions stay
 * in one pure reducer so the emitter, history coordinator and renderer cannot drift.
 */

export interface StageSheet {
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
  /** The overlay currently covering the base app, or null when the app is visible. */
  readonly sheet: StageSheet | null
  /** Only a sketch/build the user is actively waiting for; never general background work. */
  readonly activity: BuilderActivity | null
  /** Phone-only presentation. Desktop ignores it and keeps the two-column layout. */
  readonly mobileChat: MobileChatState
}

export type StageEvent =
  | { readonly type: 'stage.show'; readonly url: string; readonly title?: string }
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
  sheet: null,
  activity: null,
  // Chat is the useful empty state while the app iframe is still loading.
  mobileChat: { mode: 'full', appReady: false, unseenAssistant: false, questionPending: false },
}

/**
 * Only one sheet at a time: `stage.show` replaces whatever is up rather than
 * stacking, so `back_to_app` is always a single step back to the base app.
 */
export function stageReducer(state: StageState, event: StageEvent): StageState {
  switch (event.type) {
    case 'stage.show': {
      const url = event.url.trim()
      if (!url) return state
      const title = event.title?.trim() || 'Preview'
      const sameSheet = state.sheet?.url === url && state.sheet.title === title
      const mode = state.mobileChat.questionPending
        ? (state.mobileChat.mode === 'full' ? 'full' : 'half')
        : 'button'
      if (sameSheet && state.mobileChat.mode === mode) return state
      return {
        ...state,
        sheet: { url, title },
        mobileChat: { ...state.mobileChat, mode },
      }
    }
    case 'stage.clear':
      return state.sheet === null ? state : { ...state, sheet: null }
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
        mobileChat: {
          ...state.mobileChat,
          appReady: true,
          mode: state.mobileChat.questionPending ? 'half' : 'button',
        },
      }
    case 'chat.open':
      if (state.mobileChat.mode !== 'button' && !state.mobileChat.unseenAssistant) return state
      return { ...state, mobileChat: { ...state.mobileChat, mode: 'half', unseenAssistant: false } }
    case 'chat.expand':
      if (state.mobileChat.mode === 'full' && !state.mobileChat.unseenAssistant) return state
      return { ...state, mobileChat: { ...state.mobileChat, mode: 'full', unseenAssistant: false } }
    case 'chat.hide': {
      const mode = state.mobileChat.questionPending ? 'half' : 'button'
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
      const mode = state.mobileChat.questionPending && event.mode === 'button' ? 'half' : event.mode
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

/** Narrow unknown SSE payloads to a StageEvent; anything else is dropped. */
export function parseStageEvent(raw: unknown): StageEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.type === 'stage.clear') return { type: 'stage.clear' }
  if (candidate.type === 'activity.clear') return { type: 'activity.clear' }
  if (candidate.type === 'stage.show' && typeof candidate.url === 'string') {
    return {
      type: 'stage.show',
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
