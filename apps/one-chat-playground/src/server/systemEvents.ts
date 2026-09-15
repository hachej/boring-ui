export interface BuilderFinishedEvent {
  readonly kind: 'builder-finished'
  readonly slug: string
  readonly summary: string
}

/** A small host-authored prompt shape shared by every fresh-session completion hook. */
export function formatSystemEvent(event: BuilderFinishedEvent): string {
  const summary = event.summary.trim()
  const punctuation = /[.!?]$/.test(summary) ? '' : '.'
  return `[system event] The builder finished intent ${event.slug}: ${summary}${punctuation} Tell the user in one or two sentences and offer to show it.`
}
