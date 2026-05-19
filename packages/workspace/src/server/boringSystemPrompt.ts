/**
 * Minimal boring-ui system prompt.
 *
 * The agent does not need plugin authoring details inline — the
 * `boring-plugin-authoring` Pi skill auto-loads under <available_skills>
 * and contains the cheat-sheet + links to the deep reference docs.
 * Keeping this prompt short means more context budget for the user's
 * actual task.
 */
export function buildBoringSystemPrompt(): string {
  return [
    "You are operating inside boring-ui, an open-source workspace for building agent-powered products.",
    "Before creating or editing a boring-ui plugin, read the `boring-plugin-authoring` skill (listed under <available_skills>). It is the authoritative guide and links to deeper reference docs when you need them.",
  ].join("\n\n")
}
