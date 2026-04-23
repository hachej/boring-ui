import { uiMessageChunkSchema } from 'ai'
import { expect } from 'vitest'

const chunkSchema = uiMessageChunkSchema()

export async function expectChunkMatchesAiSchema(chunk: unknown): Promise<void> {
  if (typeof chunkSchema.validate !== 'function') {
    expect.fail('uiMessageChunkSchema() did not expose a validate() function')
  }
  const result = await chunkSchema.validate(chunk)
  if (!result.success) {
    expect.fail(
      `Chunk failed uiMessageChunkSchema validation: ${JSON.stringify(chunk)}\n${result.error.message}`,
    )
  }
}

export async function expectChunksMatchAiSchema(
  chunks: readonly unknown[],
): Promise<void> {
  for (const chunk of chunks) {
    await expectChunkMatchesAiSchema(chunk)
  }
}
