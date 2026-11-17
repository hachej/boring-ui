// The transcription providers, each one HTTP call through the app's own `fetch` (pi-ai has no audio part). Ported from boring-factory
// services/transcribe/adapters (mistral, openai, fake). A failed request throws `down` (busy, 429, 5xx, unreachable) or `refused` (the
// key, or the recording), so the next listed provider is tried; an answer that is not the provider's JSON is a refusal that stops the call.
import type { Refusal } from '../shared.js';

export type Audio = { bytes: Uint8Array; type: string; ext: string; language?: string; segments: boolean };
export type Segment = { start: number; end: number; text: string };
export type Heard = { text: string; seconds?: number; segments?: Segment[] };
type Send = (input: Audio, key: string, signal: AbortSignal, fetch: typeof globalThis.fetch) => Promise<Heard | Refusal>;
export type TranscriptionProvider = { region: 'eu' | 'us' | 'none'; key?: string; timings: boolean; usdPerMinute: number; send: Send };

const invalid: Refusal = { ok: false, kind: 'transcription-invalid-answer', retryable: false };
const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const seconded = (heard: Heard, seconds: number | undefined): Heard => (seconds === undefined ? heard : { ...heard, seconds });

async function post(url: string, form: FormData, key: string, signal: AbortSignal, fetch: typeof globalThis.fetch): Promise<Record<string, any> | Refusal> {
  let response: Response;
  try { response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal }); } catch { throw new Error('down'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(response.status === 429 || response.status >= 500 ? 'down' : 'refused');
  }
  const data = await response.json().catch(() => undefined);
  return data && typeof data === 'object' && typeof data.text === 'string' ? data : invalid;
}
function form(input: Audio, model: string) {
  const body = new FormData();
  body.append('file', new Blob([input.bytes as never], { type: input.type }), `audio.${input.ext}`);
  body.append('model', model);
  return body;
}

/** Mistral Voxtral (POST /v1/audio/transcriptions, read 2026-10-24): timed segments always; `usage.prompt_audio_seconds`. Region eu. */
const mistral: Send = async (input, key, signal, fetch) => {
  const body = form(input, 'voxtral-mini-transcribe-3');
  body.append('timestamp_granularities', 'segment');
  if (input.language) body.append('language', input.language);
  const data = await post('https://api.mistral.ai/v1/audio/transcriptions', body, key, signal, fetch);
  if ('ok' in data) return data as Refusal;
  const segments = (Array.isArray(data.segments) ? data.segments : []).slice(0, 10_000).flatMap((s: any): Segment[] => {
    const start = number(s?.start), end = number(s?.end), text = typeof s?.text === 'string' ? s.text.trim() : '';
    return start !== undefined && end !== undefined && text ? [{ start, end, text }] : [];
  });
  return seconded({ text: data.text.trim(), segments }, number(data.usage?.prompt_audio_seconds));
};

/** OpenAI gpt-transcribe (POST /v1/audio/transcriptions, read 2026-10-24): text only, `languages[]`, `usage.seconds`. Region us. */
const openai: Send = async (input, key, signal, fetch) => {
  const body = form(input, 'gpt-transcribe');
  body.append('response_format', 'json');
  if (input.language) body.append('languages[]', input.language);
  const data = await post('https://api.openai.com/v1/audio/transcriptions', body, key, signal, fetch);
  if ('ok' in data) return data as Refusal;
  const text = data.text.trim(), seconds = number(data.usage?.seconds);
  return seconded({ text, segments: text ? [{ start: 0, end: seconds ?? 0, text }] : [] }, seconds);
};

export const fakeText = (bytes: number, language?: string) => `fake transcript (${bytes} bytes, ${language ?? 'und'})`;
/** In memory, nothing sent: a text made from the recording's length and the language only, so no recording leaks through it. */
const fake: Send = async (input) => {
  const text = fakeText(input.bytes.byteLength, input.language);
  return { text, segments: [{ start: 0, end: input.bytes.byteLength / 1000, text }] };
};

/** Prices per minute billed, the card's figures (to be checked against each provider's price page). */
export const PROVIDERS: Readonly<Record<string, TranscriptionProvider>> = {
  mistral: { region: 'eu', key: 'MISTRAL_API_KEY', timings: true, usdPerMinute: 0.003, send: mistral },
  openai: { region: 'us', key: 'OPENAI_API_KEY', timings: false, usdPerMinute: 0.006, send: openai },
  fake: { region: 'none', timings: true, usdPerMinute: 0, send: fake },
};
