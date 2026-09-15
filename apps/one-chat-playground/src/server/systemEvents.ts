export interface BuilderFinishedEvent {
  readonly kind: 'builder-finished'
  readonly slug: string
  readonly summary: string
}

export interface MockupFinishedEvent {
  readonly kind: 'mockup-finished'
  readonly slug: string
  readonly summary: string
  readonly url: string
  readonly title: string
}

/** A small host-authored prompt shape shared by every fresh-session completion hook. */
export function formatSystemEvent(event: BuilderFinishedEvent | MockupFinishedEvent): string {
  const summary = event.summary.trim()
  const punctuation = /[.!?]$/.test(summary) ? '' : '.'
  if (event.kind === 'mockup-finished') {
    return `[system event] The builder finished the MOCKUP for intent ${event.slug}: ${summary}${punctuation} Show it with show_on_screen at ${event.url} titled "${event.title}", say "Here is a sketch; nothing works yet.", then use ask_user with "Keep it (recommended)", "Change it", and "Something else", and wait.`
  }
  return `[system event] The builder finished intent ${event.slug}: ${summary}${punctuation} Tell the user in one or two sentences and suggest exactly one useful next step.`
}
