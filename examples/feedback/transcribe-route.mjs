// Example glue, not library code: the example's transcription route, which an app copies or replaces. The page's `transcribe`
// callback (browser.jsx) POSTs the recorded audio (the `VoiceCapture.stop()` blob, its own audio/* type as Content-Type) and gets
// back `{ segments, text }`, segments in seconds from the start of the audio, which the feedback session aligns with the pointer.
// Server-side only: the provider (transcription.mjs) holds the credential. Wire it as, for example,
//   const transcribe = transcribeHandler({ provider: transcriptionFromEnv(), authorize: request => Boolean(byToken(request)) });
//   ... url.pathname === '/api/transcribe' ? await transcribe(request) : ...
import { TranscriptionError, transcriptionFromEnv } from './transcription.mjs';

export { transcriptionFromEnv };

/** The largest recording the route accepts (25 MB). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

async function readBytes(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new RangeError('too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/**
 * `(request: Request) => Promise<Response>`. `authorize(request)` decides who may transcribe (falsy: 401, before the body is read).
 * Answers 405 for anything but POST, 503 when the provider is not configured, 415 unless the body is audio/*, 413 over `maxBytes`,
 * the provider's status (400/502/503) when it refuses, else 200 `{ segments, text }`. An optional `?language=xx` is passed on.
 */
export function transcribeHandler({ provider, authorize, maxBytes = MAX_AUDIO_BYTES }) {
  if (!provider || typeof provider.transcribe !== 'function') throw new TypeError('transcribeHandler needs a transcription provider');
  if (typeof authorize !== 'function') throw new TypeError('transcribeHandler needs authorize(request)');
  return async request => {
    if (request.method !== 'POST') return Response.json({ reason: 'Use POST with the recorded audio.' }, { status: 405, headers: { allow: 'POST' } });
    if (!(await authorize(request))) return Response.json({ reason: 'Sign in to transcribe.' }, { status: 401 });
    if (!provider.configured()) return Response.json({ reason: `Transcription is not available: ${provider.unconfigured ?? 'not configured'}` }, { status: 503 });
    const mimeType = request.headers.get('content-type') ?? '';
    if (!/^audio\/[a-z0-9.+-]+(;.*)?$/i.test(mimeType)) return Response.json({ reason: 'The body must be audio (an audio/* Content-Type).' }, { status: 415 });
    let bytes;
    try { bytes = await readBytes(request, maxBytes); } catch { return Response.json({ reason: 'The recording is too large to transcribe.' }, { status: 413 }); }
    const language = new URL(request.url).searchParams.get('language');
    try {
      const transcript = await provider.transcribe({ bytes, mimeType, ...(language && /^[a-z]{2}$/.test(language) ? { language } : {}) });
      return Response.json({ segments: transcript.segments, text: transcript.text });
    } catch (error) {
      if (error instanceof TranscriptionError) return Response.json({ reason: error.message }, { status: error.status });
      return Response.json({ reason: 'Transcription failed.' }, { status: 502 });
    }
  };
}
