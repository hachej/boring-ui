import type { WhisperLiveKitLine, WhisperLiveKitSnapshot } from "./whisperLiveKit"

const PARAGRAPH_PAUSE_SECONDS = 1.5
const TARGET_PARAGRAPH_WORDS = 50
const TARGET_PARAGRAPH_CHARACTERS = 400
const LEADING_PUNCTUATION = /^[,.;:!?…%)}\]]/u

/** Groups Kyutai's word-level protocol events into pause-bounded paragraphs. */
export function groupKyutaiTranscriptSnapshot(snapshot: WhisperLiveKitSnapshot): WhisperLiveKitSnapshot {
  const grouped: WhisperLiveKitLine[] = []
  let previousWord: WhisperLiveKitLine | undefined
  let wordCount = 0

  for (const source of snapshot.lines) {
    const text = source.text.trim()
    if (!text) continue
    const current = grouped.at(-1)
    const sourceWordCount = countWords(text)
    const pauseSeconds = previousWord?.endSeconds === undefined
      ? 0
      : Math.max(0, source.startSeconds - previousWord.endSeconds)
    const startsNewParagraph = !current
      || current.speaker !== source.speaker
      || pauseSeconds >= PARAGRAPH_PAUSE_SECONDS
      || wordCount + sourceWordCount > TARGET_PARAGRAPH_WORDS
      || current.text.length + text.length + 1 > TARGET_PARAGRAPH_CHARACTERS

    if (startsNewParagraph) {
      grouped.push({ ...source, text })
      // Preserve an oversized protocol event intact; the target bounds only
      // decide whether separate events belong to the same readable row.
      wordCount = sourceWordCount
    } else {
      current.text = joinText(current.text, text)
      current.endSeconds = source.endSeconds
      wordCount += sourceWordCount
    }
    previousWord = source
  }

  return { ...snapshot, lines: grouped }
}

function joinText(left: string, right: string): string {
  return LEADING_PUNCTUATION.test(right) ? `${left}${right}` : `${left} ${right}`
}

function countWords(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length
}
