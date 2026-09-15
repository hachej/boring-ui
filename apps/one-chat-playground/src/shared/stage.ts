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

export interface StageState {
  /** The overlay currently covering the base app, or null when the app is visible. */
  readonly sheet: StageSheet | null
}

export type StageEvent =
  | { readonly type: 'stage.show'; readonly url: string; readonly title?: string }
  | { readonly type: 'stage.clear' }

export const STAGE_EVENT_TYPES = ['stage.show', 'stage.clear'] as const

export const initialStageState: StageState = { sheet: null }

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
      return { sheet: { url, title } }
    }
    case 'stage.clear':
      return state.sheet === null ? state : initialStageState
    default:
      return state
  }
}

/** Narrow unknown SSE payloads to a StageEvent; anything else is dropped. */
export function parseStageEvent(raw: unknown): StageEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as { type?: unknown; url?: unknown; title?: unknown }
  if (candidate.type === 'stage.clear') return { type: 'stage.clear' }
  if (candidate.type === 'stage.show' && typeof candidate.url === 'string') {
    return {
      type: 'stage.show',
      url: candidate.url,
      ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}),
    }
  }
  return null
}
