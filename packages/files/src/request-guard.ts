/**
 * The one request-body guard of every `create*Handler` in the packages (resource, remote files, remote shell, chat
 * transport): a JSON content type is required and the body is streamed under a byte cap, so a cross-site `text/plain`
 * form POST and an oversized body are both refused before any parsing or full buffering. `npm run check` fails when a
 * `create*Handler` does not import this module, so the handlers cannot drift apart.
 */
export const JSON_CONTENT_TYPE = 'application/json';

/** A refused request body. `status` is the HTTP status the handler answers with. */
export class RequestGuardError extends Error {
  readonly status: 400 | 413 | 415;
  constructor(status: 400 | 413 | 415, message: string) { super(message); this.name = 'RequestGuardError'; this.status = status; }
}

/** The HTTP status for a guard refusal, or 400 for any other body failure. */
export function guardStatus(error: unknown): 400 | 413 | 415 {
  return error instanceof RequestGuardError ? error.status : 400;
}

export function hasJsonContentType(headers: Headers): boolean {
  return headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}

/** Read a stream as JSON without ever holding more than `maximum` bytes. No content-type check: see `readJsonBody`. */
export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, maximum: number, signal?: AbortSignal): Promise<unknown> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('Expected a positive byte limit');
  if (!body) throw new RequestGuardError(400, 'Missing request body');
  const reader = body.getReader();
  let fail: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    fail = () => reject(new Error('Request body read aborted'));
    if (signal?.aborted) fail(); else signal?.addEventListener('abort', fail, { once: true });
  });
  abort.catch(() => {});
  try {
    let size = 0, buffer = new Uint8Array(Math.min(maximum, 16_384));
    while (true) {
      const item = await (signal ? Promise.race([reader.read(), abort]) : reader.read());
      if (item.done) break;
      if (item.value.byteLength > maximum - size) throw new RequestGuardError(413, 'Request body exceeds its byte limit');
      const next = size + item.value.byteLength;
      if (next > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(maximum, Math.max(next, buffer.byteLength * 2)));
        grown.set(buffer.subarray(0, size));
        buffer = grown;
      }
      buffer.set(item.value, size);
      size = next;
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
    catch { throw new RequestGuardError(400, 'Request body is not valid JSON'); }
  } finally {
    if (fail) signal?.removeEventListener('abort', fail);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Require `application/json`, refuse a declared length over the cap early, then read the body under the cap. */
export async function readJsonBody(message: Request | Response, maximum: number, signal?: AbortSignal): Promise<unknown> {
  if (!hasJsonContentType(message.headers)) throw new RequestGuardError(415, 'Request content type must be application/json');
  const declared = Number(message.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new RequestGuardError(413, 'Request body exceeds its byte limit');
  return readBoundedJson(message.body, maximum, signal);
}
