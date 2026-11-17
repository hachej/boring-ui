// The route an app mounts itself for the kit's microphone: POST a recording, get its text. The app's own function signs the request and
// returns the options (with the person's `meter.userId`) or a Response (401, 403) answered as is, before the body is read. No host.
import type { CapOptions } from '../shared.js';
import { MAX_BYTES, bytesOf, transcribe } from './transcribe.js';

type Options = CapOptions | ((request: Request) => CapOptions | Response | Promise<CapOptions | Response>);
const STATUS: Record<string, number> = {
  'transcription-type': 415, 'transcription-empty': 400, 'transcription-language': 400, 'transcription-segments': 400,
  unavailable: 503, timeout: 503, 'transcription-failed': 502, 'transcription-invalid-answer': 502,
  unconfigured: 500, 'transcription-provider': 500, 'transcription-fetch': 500, aborted: 499,
};
const answer = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refused = (kind: string) => answer(kind.startsWith('transcription-too-large') ? 413 : STATUS[kind] ?? 402, { error: kind });

/** `(request) => Response`: 200 `{ text, segments?, provider, untrusted: true }`, or `{ error: <kind> }` with the kind's status. */
export function transcribeHandler(options: Options): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return answer(405, { error: 'method' });
    if (!/^audio\/[a-z0-9.+-]+/i.test(request.headers.get('content-type') ?? '')) return refused('transcription-type');
    const chosen = typeof options === 'function' ? await options(request) : options;
    if (chosen instanceof Response) return chosen;
    if (Number(request.headers.get('content-length')) > MAX_BYTES) return refused(`transcription-too-large:${MAX_BYTES}`);
    const audio = await bytesOf(request.body).catch(() => new Uint8Array());
    if (!audio) return refused(`transcription-too-large:${MAX_BYTES}`);
    const query = new URL(request.url).searchParams, segments = query.get('segments');
    const signal = chosen.signal ? AbortSignal.any([request.signal, chosen.signal]) : request.signal;
    const result = await transcribe({ audio, ...(query.has('language') && { language: query.get('language')! }), ...(segments !== null && { segments: segments === 'true' ? true : segments === 'false' ? false : segments as never }) }, { ...chosen, signal });
    if (!result.ok) return refused(result.kind);
    return answer(200, { text: result.text, ...(result.segments && { segments: result.segments }), provider: result.provider, untrusted: true });
  };
}
