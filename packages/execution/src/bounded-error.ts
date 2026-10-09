// No imports: shared by the virtual workspace and the AWS Code Interpreter environment without loading either one's dependencies.
/** Largest error text, in characters, that the shell, Git and the native environment of a workspace pass on (into a tool result). */
export const MAX_ERROR_CHARS = 2000;
/**
 * The one bound on error text leaving a workspace environment (virtual or AWS Code Interpreter): the message only, never a stack (stack frames are dropped even when a backing
 * put them in its message), at most `MAX_ERROR_CHARS`. The whole error stays on `cause` for the host's own logs.
 */
export function boundedMessage(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\n[ \t]*at [^\n]*/g, '').trim() || 'Unknown error';
  const note = ` [error truncated at ${MAX_ERROR_CHARS} characters]`;
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - note.length)}${note}` : text;
}
