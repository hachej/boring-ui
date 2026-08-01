export type LiveTranscriptReviewKind = 'automatic' | 'manual' | 'final'

export interface LiveTranscriptReviewPresentation {
  kind: LiveTranscriptReviewKind
  transcriptPath: string
}

const PRESENTATION_PATTERN = /^Transcript review requested \((automatic|manual|final)\): (live-transcripts\/\S+)$/

export function encodeLiveTranscriptReviewPresentation(value: LiveTranscriptReviewPresentation): string {
  return `Transcript review requested (${value.kind}): ${value.transcriptPath}`
}

export function decodeLiveTranscriptReviewPresentation(value: string): LiveTranscriptReviewPresentation | undefined {
  const match = PRESENTATION_PATTERN.exec(value)
  if (!match) return undefined
  const transcriptPath = match[2]!
  if (transcriptPath.length > 1_024 || transcriptPath.includes('..')) return undefined
  return { kind: match[1] as LiveTranscriptReviewKind, transcriptPath }
}
