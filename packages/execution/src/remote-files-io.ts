import { readBoundedJson } from '@hachej/boring-files/request-guard';
import type { Context } from '@earendil-works/chord';

/** Read a response body as JSON under a byte cap (the shared guard of `@hachej/boring-files/request-guard`). */
export function readJson(body: ReadableStream<Uint8Array> | null, context: Context, limit: number): Promise<unknown> {
  return readBoundedJson(body, limit, context.abortSignal);
}

export function frameReader(body: ReadableStream<Uint8Array>, limit: number) {
  const reader = body.getReader();
  let chunk: Uint8Array = new Uint8Array(), offset = 0;
  let buffer = new Uint8Array(Math.min(4096, limit)), length = 0;
  let closed = false;
  const close = async (): Promise<void> => { if (closed) return; closed = true; void reader.cancel().catch(() => {}); reader.releaseLock(); };
  const next = async (): Promise<unknown> => {
    while (!closed) {
      if (offset === chunk.length) {
        const item = await reader.read();
        if (item.done) { if (length) throw new TypeError('Truncated frame'); return undefined; }
        chunk = item.value; offset = 0;
      }
      const newline = chunk.indexOf(10, offset), end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      if (length + part.length > limit) throw new TypeError('Frame byte limit exceeded');
      if (length + part.length > buffer.length) {
        const larger = new Uint8Array(Math.min(limit, Math.max(length + part.length, buffer.length * 2)));
        larger.set(buffer.subarray(0, length)); buffer = larger;
      }
      buffer.set(part, length); length += part.length; offset = end + (newline === -1 ? 0 : 1);
      if (newline !== -1) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); length = 0;
        return JSON.parse(text);
      }
    }
    throw new TypeError('Reader is closed');
  };
  return { next, close };
}
