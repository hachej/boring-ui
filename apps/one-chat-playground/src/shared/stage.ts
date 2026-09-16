/** Host-driven screen state plus the responsive chat-presence state machine. */

export type StageScreenKind = 'app' | 'page'

export interface StageScreen {
  readonly what: StageScreenKind
  readonly url: string
  readonly title: string
  readonly label?: 'preview' | 'version'
  readonly versionLabel?: string
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

export type DesktopChatPresence = 'bar' | 'window' | 'column'
export type MobileChatPresence = 'button' | 'half' | 'full'
export type ChatPresence = DesktopChatPresence | MobileChatPresence
export type ChatViewport = 'desktop' | 'phone'

export interface ChatPresenceState {
  readonly viewport: ChatViewport
  readonly mode: ChatPresence
  readonly remembered: boolean
  readonly stageSeen: boolean
  readonly questionPending: boolean
  readonly unseenAssistant: boolean
  readonly peek: string | null
  readonly replyVersion: number
}

export type ChatPresenceEvent =
  | { readonly type: 'userExpand' }
  | { readonly type: 'userCollapse' }
  | { readonly type: 'colleagueNeedsRoom' }
  | { readonly type: 'cardPending'; readonly pending: boolean }
  | { readonly type: 'stageShown' }
  | { readonly type: 'replyArrived'; readonly preview: string }
  | { readonly type: 'peekExpired'; readonly replyVersion: number }
  | { readonly type: 'restore'; readonly mode: MobileChatPresence }

export function createInitialChatPresence(
  viewport: ChatViewport,
  rememberedDesktopMode: DesktopChatPresence | null = null,
): ChatPresenceState {
  return {
    viewport,
    mode: viewport === 'phone' ? 'full' : rememberedDesktopMode ?? 'column',
    remembered: viewport === 'desktop' && rememberedDesktopMode !== null,
    stageSeen: false,
    questionPending: false,
    unseenAssistant: false,
    peek: null,
    replyVersion: 0,
  }
}

function clearReplyNotice(state: ChatPresenceState): Pick<ChatPresenceState, 'peek' | 'unseenAssistant'> {
  return { peek: null, unseenAssistant: false }
}

/**
 * One reducer owns both ladders. The phone keeps its existing snap behavior:
 * collapse closes either open sheet, while desktop collapse moves down one rung.
 */
export function chatPresenceReducer(state: ChatPresenceState, event: ChatPresenceEvent): ChatPresenceState {
  if (state.viewport === 'phone') return reducePhonePresence(state, event)
  return reduceDesktopPresence(state, event)
}

function reduceDesktopPresence(state: ChatPresenceState, event: ChatPresenceEvent): ChatPresenceState {
  switch (event.type) {
    case 'userExpand': {
      const mode = state.mode === 'bar' ? 'window' : state.mode === 'window' ? 'column' : 'column'
      if (mode === state.mode && !state.peek && !state.unseenAssistant) return state
      return { ...state, mode, remembered: true, ...clearReplyNotice(state) }
    }
    case 'userCollapse': {
      const mode = state.mode === 'column'
        ? 'window'
        : state.mode === 'window' && !state.questionPending
          ? 'bar'
          : state.mode
      if (mode === state.mode && !state.peek && !state.unseenAssistant) return state
      return { ...state, mode, remembered: true, ...clearReplyNotice(state) }
    }
    case 'colleagueNeedsRoom':
      if (state.mode !== 'bar') return state
      return { ...state, mode: 'window', remembered: true, ...clearReplyNotice(state) }
    case 'cardPending': {
      const mode = event.pending && state.mode === 'bar' ? 'window' : state.mode
      if (state.questionPending === event.pending && mode === state.mode) return state
      return {
        ...state,
        mode,
        remembered: state.remembered,
        questionPending: event.pending,
        ...(event.pending ? clearReplyNotice(state) : {}),
      }
    }
    case 'stageShown': {
      if (state.stageSeen) return state
      const rememberedMode = state.remembered ? state.mode : 'bar'
      const mode = state.questionPending && rememberedMode === 'bar' ? 'window' : rememberedMode
      return { ...state, mode, remembered: true, stageSeen: true, ...clearReplyNotice(state) }
    }
    case 'replyArrived': {
      if (state.mode !== 'bar') return state
      return {
        ...state,
        peek: event.preview,
        unseenAssistant: false,
        replyVersion: state.replyVersion + 1,
      }
    }
    case 'peekExpired':
      if (event.replyVersion !== state.replyVersion || state.mode !== 'bar' || !state.peek) return state
      return { ...state, peek: null, unseenAssistant: true }
    case 'restore':
      return state
    default:
      return state
  }
}

function reducePhonePresence(state: ChatPresenceState, event: ChatPresenceEvent): ChatPresenceState {
  switch (event.type) {
    case 'userExpand': {
      const mode = state.mode === 'button' ? 'half' : state.mode === 'half' ? 'full' : 'full'
      if (mode === state.mode && !state.unseenAssistant) return state
      return { ...state, mode, ...clearReplyNotice(state) }
    }
    case 'userCollapse': {
      const mode = state.questionPending ? 'half' : 'button'
      if (mode === state.mode) return state
      return { ...state, mode }
    }
    case 'colleagueNeedsRoom':
      if (state.mode !== 'button') return state
      return { ...state, mode: 'half', ...clearReplyNotice(state) }
    case 'cardPending': {
      const mode = event.pending && state.mode === 'button' ? 'half' : state.mode
      if (state.questionPending === event.pending && mode === state.mode) return state
      return {
        ...state,
        mode,
        questionPending: event.pending,
        ...(event.pending ? clearReplyNotice(state) : {}),
      }
    }
    case 'stageShown': {
      const mode = state.questionPending
        ? (state.mode === 'full' ? 'full' : 'half')
        : 'button'
      if (state.stageSeen && mode === state.mode) return state
      return { ...state, mode, stageSeen: true, ...clearReplyNotice(state) }
    }
    case 'replyArrived':
      if (state.mode !== 'button' || state.unseenAssistant) return state
      return { ...state, unseenAssistant: true }
    case 'peekExpired':
      return state
    case 'restore': {
      const mode = state.questionPending && event.mode === 'button' ? 'half' : event.mode
      if (mode === state.mode && (mode === 'button' || !state.unseenAssistant)) return state
      return {
        ...state,
        mode,
        unseenAssistant: mode === 'button' && state.unseenAssistant,
        peek: null,
      }
    }
    default:
      return state
  }
}

export function firstReplyLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
}

/** A newline or a line too wide for the detached window needs transcript room. */
export function replyNeedsRoom(text: string): boolean {
  const trimmed = text.trim()
  return /\r?\n/.test(trimmed) || firstReplyLine(trimmed).length > 100
}

export interface StageState {
  /** Null means chat owns the available space. */
  readonly screen: StageScreen | null
  readonly activity: BuilderActivity | null
}

export type StageEvent =
  | {
      readonly type: 'stage.show'
      readonly what: StageScreenKind
      readonly url: string
      readonly title?: string
      readonly label?: 'preview' | 'version'
      readonly versionLabel?: string
    }
  | { readonly type: 'stage.clear' }
  | ({ readonly type: 'activity.started' } & Omit<BuilderActivity, 'milestone'>)
  | ({ readonly type: 'activity.verifying' | 'activity.done' } & Omit<BuilderActivity, 'milestone'>)
  | { readonly type: 'activity.clear' }

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
}

export function stageReducer(state: StageState, event: StageEvent): StageState {
  switch (event.type) {
    case 'stage.show': {
      const url = event.url.trim()
      if (!url) return state
      const title = event.title?.trim() || (event.what === 'app' ? 'Your app' : 'Preview')
      const screen = {
        what: event.what,
        url,
        title,
        ...(event.label ? { label: event.label } : {}),
        ...(event.versionLabel?.trim() ? { versionLabel: event.versionLabel.trim() } : {}),
      } as const
      if (
        state.screen?.what === screen.what
        && state.screen.url === screen.url
        && state.screen.title === screen.title
        && state.screen.label === screen.label
        && state.screen.versionLabel === screen.versionLabel
      ) return state
      return { ...state, screen }
    }
    case 'stage.clear':
      return state.screen === null ? state : { ...state, screen: null }
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
      ...((candidate.label === 'preview' || candidate.label === 'version') ? { label: candidate.label } : {}),
      ...(typeof candidate.versionLabel === 'string' ? { versionLabel: candidate.versionLabel } : {}),
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
