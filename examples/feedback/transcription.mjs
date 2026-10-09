// Example glue, not library code: an app copies this file, changes it or replaces it with its own transcription. @hachej/boring-feedback
// only asks the page for a `transcribe(audio, mimeType)` callback that answers `{ text, segments? }` (FEEDBACK.md, "Voice"); where
// the audio goes is the application's choice. This example's server turns speech into timed text with one of two providers:
//
// - `serviceTranscription`: a client for a transcription service with the small HTTP contract below, at the URL the app configures
//   (for example `https://transcription.example.com`). Pass-through (it stores nothing); every /v1 call carries the app's own service key, which stays on this server: it is never logged, never
//   returned and never sent to the browser. Batch only: POST /v1/transcriptions with the recorded audio and `segments=true`,
//   because pointer alignment needs timed segments. The provider is chosen at runtime from GET /v1/capabilities (the first one
//   with batch and segments, unless the app names one); a provider failure (502, e.g. an account out of credit) tries the next
//   one, and the one that answered is tried first next time. Errors follow the service and are read as plain reasons: 401 is a
//   key problem, 413 too long, 429 means back off, 502 a provider failure the person may retry; nothing is retried inside one
//   call. Audio and transcript text are never logged.
// - `fakeTranscription`: deterministic segments, no network and no key, for the journeys and tests.
//
// `transcriptionFromEnv` picks the service when TRANSCRIPTION_API_KEY is set (with TRANSCRIPTION_URL, which has no default;
// FEEDBACK_TRANSCRIPTION_PROVIDER optional), else the fake.

/** A refusal with the HTTP status the example's route answers and a reason the person can read. */
export class TranscriptionError extends Error {
  constructor(status, message) { super(message); this.status = status; this.name = 'TranscriptionError'; }
}

/** Throws (400) unless the request is audio a provider may send; called before any network effect. */
export function assertAudio(request) {
  const { bytes, mimeType } = request ?? {};
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new TranscriptionError(400, 'transcription: no audio');
  if (typeof mimeType !== 'string' || !/^audio\/[a-z0-9.+-]+(;.*)?$/i.test(mimeType)) throw new TranscriptionError(400, `transcription: an audio/* type, got ${JSON.stringify(mimeType)}`);
}

/** Deterministic segments, no network. `segments` may be an array or a function of the request. */
export function fakeTranscription({ segments } = {}) {
  const defaults = request => [
    { start: 0, end: 1.5, text: 'Fake transcript: this is where the person spoke.' },
    { start: 1.5, end: 3, text: `(${Math.max(1, Math.round(request.bytes.length / 1024))} KB of ${request.mimeType.split(';')[0]})` },
  ];
  return Object.freeze({
    configured: () => true,
    unconfigured: null,
    async transcribe(request) {
      assertAudio(request);
      const given = typeof segments === 'function' ? segments(request) : segments;
      const out = [...(given ?? defaults(request))];
      return { provider: 'fake', text: out.map(segment => segment.text).join(' '), segments: out };
    },
  });
}

/** What the person reads for a service error code (never the provider's raw message). */
const reasonOf = (status, code) =>
  status === 401 ? 'the transcription key was refused' :
  status === 413 ? 'the recording is too long to transcribe' :
  status === 429 ? 'the transcription service is busy, try again in a moment' :
  status === 502 ? 'the transcription provider failed, try again' :
  status === 503 || status === 504 ? 'the transcription service is unavailable right now' :
  `transcription refused (${code || status})`;

/** `{ apiKey, url?, provider?, fetch?, timeoutMs? }`; see the header. */
export function serviceTranscription({ apiKey = null, url = null, provider, fetch = globalThis.fetch, timeoutMs = 180_000 } = {}) {
  const base = typeof url === 'string' ? url.replace(/\/+$/, '') : '';
  const missing = !apiKey ? 'TRANSCRIPTION_API_KEY is not set on this server' : !/^https?:\/\//.test(base) ? 'TRANSCRIPTION_URL is not set on this server' : null;
  const headers = () => ({ authorization: `Bearer ${apiKey}` });
  // Usable providers in the service's order; the one that last answered moves to the front.
  let order = provider ? Promise.resolve([provider]) : null;

  const providers = () => {
    order ??= (async () => {
      const response = await fetch(`${base}/v1/capabilities`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) { order = null; throw new TranscriptionError(response.status === 401 ? 401 : 503, reasonOf(response.status, '')); }
      const caps = await response.json().catch(() => ({}));
      return (Array.isArray(caps?.providers) ? caps.providers : []).filter(item => item?.batch === true && item?.segments === true && typeof item?.name === 'string').map(item => item.name);
    })();
    return order;
  };

  return Object.freeze({
    configured: () => missing === null,
    unconfigured: missing,
    async transcribe(request) {
      assertAudio(request);
      if (missing) throw new TranscriptionError(503, `transcription unavailable: ${missing}`);
      const names = await providers();
      if (!names.length) throw new TranscriptionError(503, 'no transcription provider with timed segments is available');
      let failure = null;
      for (const name of names) {
        const query = new URLSearchParams({ provider: name, segments: 'true', ...(request.language ? { language: request.language } : {}) });
        const response = await fetch(`${base}/v1/transcriptions?${query}`, {
          method: 'POST', headers: { ...headers(), 'content-type': request.mimeType }, body: new Uint8Array(request.bytes), signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          failure = new TranscriptionError([401, 413, 429].includes(response.status) ? response.status : 502, reasonOf(response.status, String(data?.error?.code ?? '')));
          if (response.status === 502 && !provider) continue; // this provider failed: try the next one
          throw failure;
        }
        if (!provider && names[0] !== name) order = Promise.resolve([name, ...names.filter(other => other !== name)]);
        const segments = (Array.isArray(data?.segments) ? data.segments : []).flatMap(item => {
          const text = String(item?.text ?? '').trim();
          const start = Number(item?.start) || 0, end = Number(item?.end) || 0;
          return text ? [{ start, end: Math.max(start, end), text }] : [];
        });
        return { provider: String(data?.provider ?? name), text: String(data?.text ?? '').trim(), segments };
      }
      throw failure ?? new TranscriptionError(502, 'the transcription provider failed, try again');
    },
  });
}

/** The configured service when TRANSCRIPTION_API_KEY is set (its URL from TRANSCRIPTION_URL), else the keyless fake. The key stays on this server. */
export function transcriptionFromEnv(env = process.env) {
  if (!env.TRANSCRIPTION_API_KEY) return fakeTranscription();
  return serviceTranscription({ apiKey: env.TRANSCRIPTION_API_KEY, url: env.TRANSCRIPTION_URL ?? null, ...(env.FEEDBACK_TRANSCRIPTION_PROVIDER ? { provider: env.FEEDBACK_TRANSCRIPTION_PROVIDER } : {}) });
}
