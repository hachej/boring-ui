export type LiveTranscriptReviewKind = 'automatic' | 'manual' | 'final'

export interface LiveTranscriptReviewPresentation {
  kind: LiveTranscriptReviewKind
  transcriptPath: string
}

const LIVE_TRANSCRIPT_REVIEW_PREFIX = '__BORING_LIVE_TRANSCRIPT_REVIEW_V1__'

export function encodeLiveTranscriptReviewPresentation(value: LiveTranscriptReviewPresentation): string {
  return `${LIVE_TRANSCRIPT_REVIEW_PREFIX}${JSON.stringify(value)}`
}

export function decodeLiveTranscriptReviewPresentation(value: string): LiveTranscriptReviewPresentation | undefined {
  if (!value.startsWith(LIVE_TRANSCRIPT_REVIEW_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(value.slice(LIVE_TRANSCRIPT_REVIEW_PREFIX.length)) as Record<string, unknown>
    if (parsed.kind !== 'automatic' && parsed.kind !== 'manual' && parsed.kind !== 'final') return undefined
    if (typeof parsed.transcriptPath !== 'string' || !parsed.transcriptPath.startsWith('live-transcripts/')) return undefined
    if (parsed.transcriptPath.length > 1_024 || parsed.transcriptPath.includes('..')) return undefined
    return { kind: parsed.kind, transcriptPath: parsed.transcriptPath }
  } catch {
    return undefined
  }
}
