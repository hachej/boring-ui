/**
 * How much of a turn the transcript shows.
 *
 * - `full` (default): everything — text, reasoning, tool calls, tool groups.
 * - `messages-only`: just the conversation. Reasoning and tool activity are
 *   suppressed and a streaming turn shows one quiet status line instead. For
 *   hosts whose user is not a developer and for whom "ran bash" is noise, not
 *   progress.
 */
export type ChatRenderMode = 'full' | 'messages-only'

/** @deprecated The composer shows the working status; the transcript no longer duplicates it. */
export const MESSAGES_ONLY_WORKING_LABEL = 'Working on it…'
