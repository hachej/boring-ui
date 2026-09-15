/**
 * The stage is the right-hand half of "One Chat, One Screen": a base iframe
 * showing the user's app, and at most one overlay sheet the agent can raise
 * over it. The whole thing is two events and a three-field state, kept pure
 * here so the server (emitter) and the front (renderer) cannot drift.
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

export interface StageState {
  /** The overlay currently covering the base app, or null when the app is visible. */
  readonly sheet: StageSheet | null
  /** Only a sketch/build the user is actively waiting for; never general background work. */
  readonly activity: BuilderActivity | null
}

export type StageEvent =
  | { readonly type: 'stage.show'; readonly url: string; readonly title?: string }
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

export const initialStageState: StageState = { sheet: null, activity: null }

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
      if (state.sheet && state.sheet.url === url && state.sheet.title === title) return state
      return { ...state, sheet: { url, title } }
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
