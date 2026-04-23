// Re-export AI SDK SSE utilities.
// The ai package's d.ts has transitive type-resolution issues in this
// project's TS config (json-schema lacks declarations, @google/genai
// references missing MCP types). Runtime exports work fine; only the
// TS declaration graph is broken.  Isolating the suppress here keeps
// the rest of the codebase clean.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — see comment above
export { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai'

export type { UIMessage, UIMessageChunk } from 'ai'
