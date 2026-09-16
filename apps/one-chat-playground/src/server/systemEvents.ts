export interface BuilderFinishedEvent {
  readonly kind: 'builder-finished'
  readonly slug: string
  readonly summary: string
  readonly url: string
  readonly title: string
  readonly revision: number
}

export interface MockupFinishedEvent {
  readonly kind: 'mockup-finished'
  readonly slug: string
  readonly summary: string
  readonly url: string
  readonly title: string
  readonly revision: number
}

/** A small host-authored prompt shape shared by every fresh-session completion hook. */
export function formatSystemEvent(event: BuilderFinishedEvent | MockupFinishedEvent): string {
  const summary = event.summary.trim()
  const punctuation = /[.!?]$/.test(summary) ? '' : '.'
  if (event.kind === 'mockup-finished') {
    return `[system event] The builder finished the MOCKUP for intent ${event.slug} at revision v${event.revision}: ${summary}${punctuation} The checked sketch is already on screen at "${event.url}" titled "${event.title}". Say "Here is a sketch; nothing works yet.", then use ask_user with "Keep it (recommended)", "Change it", and "Something else", and wait.`
  }
  return `[system event] The builder finished intent ${event.slug} at revision v${event.revision}: ${summary}${punctuation} The verified preview is already on screen at "${event.url}" titled "${event.title}". Say it is a preview where nothing is saved, then ask whether to keep it, change something, or leave it as it was.`
}
