// What the capabilities share (llm, extraction, transcription, decision): one plain call with a listed-provider failover, an optional meter,
// one time limit and a run id built from the input. No host, no Effect, no environment, no console. Runs on Workers (WebCrypto only).
import type { Usage } from '@earendil-works/pi-ai';
import type { MeteringReservation, MeteringSink } from '../metering.js';

export type Region = 'eu' | 'us' | 'global' | 'none';
export type Refusal = { readonly ok: false; readonly kind: string; readonly retryable: boolean };
export type Answered = { readonly ok: true; readonly provider: string; readonly region: Region; readonly counted: boolean };
export type Meter = { readonly sink: MeteringSink; readonly userId: string };
export type CapOptions = {
  readonly providers: readonly string[];
  /** What the app passes (a Worker's env). Each provider reads only its own key name; never process.env. */
  readonly keys?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  /** The whole call, the meter's check included. */
  readonly timeoutMs?: number;
  /** Absent, or `sink.isEnabled()` false: the call is uncounted and the result says `counted: false`. */
  readonly meter?: Meter;
  readonly fetch?: typeof fetch;
};
/** `key` is the key's name in `CapOptions.keys`, e.g. MISTRAL_API_KEY. */
export type Provider = { readonly name: string; readonly region: Region; readonly key?: string };
export type Charge = { readonly bucket: string; readonly usage: Usage; readonly amountMicros: number };
export type Send<T> = (provider: Provider, key: string | undefined, signal: AbortSignal, record: (charge: Charge) => Promise<void>) => Promise<T | Refusal>;

const refuse = (kind: string, retryable: boolean): Refusal => ({ ok: false, kind, retryable });
const isRefusal = (value: unknown): value is Refusal => typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data: string | Uint8Array) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : (data as Uint8Array<ArrayBuffer>)));

/** The input as plain JSON, each byte array replaced by the sha256 hex of its bytes. */
async function plain(value: unknown): Promise<unknown> {
  if (value instanceof Uint8Array) return sha256(value);
  if (value instanceof ArrayBuffer) return sha256(new Uint8Array(value));
  if (Array.isArray(value)) return Promise.all(value.map(plain));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await plain(v)])));
  return value;
}

/** A zero-token Usage whose cost.total is the charge in USD (seconds, pages). */
export function usageOf(usd: number): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usd } };
}
export const refusedText = (r: Refusal): string => r.retryable ? `failed: ${r.kind}. You may call once more; if it fails again, tell the person.` : `refused: ${r.kind}. Stop and tell the person.`;
/** `<conversation>.<task>`: stable across a replay. */
export const toolKey = (api: { conversationId: number; taskId: number }): string => `${api.conversationId}.${api.taskId}`;

/** One capability call. Never throws for an expected failure: the answer carries `ok: true`, anything else is a Refusal. */
export async function call<T>(need: string, input: unknown, options: CapOptions, table: Readonly<Record<string, Provider>>, send: Send<T>, tool?: string): Promise<(T & Answered) | Refusal> {
  const names = options.providers;
  if (!names.length) return refuse('unconfigured', false);
  if (names.some((name) => !Object.hasOwn(table, name))) return refuse(`${need}-provider`, false);
  const sink = options.meter && options.meter.sink.isEnabled?.() !== false ? options.meter.sink : undefined;
  const userId = options.meter?.userId ?? '';
  const requestId = tool ?? crypto.randomUUID();
  const runId = `${need}:${(await sha256(JSON.stringify(await plain([userId, input])))).slice(0, 16)}:${requestId}`;
  const scope = { userId, conversationId: 0, requestId, runId };

  const ctl = new AbortController();
  let stopped: Refusal | undefined;
  const stop = (why: Refusal) => { stopped ??= why; ctl.abort(); };
  const onAbort = () => stop(refuse('aborted', false));
  const timer = options.timeoutMs ? setTimeout(() => stop(refuse('timeout', true)), options.timeoutMs) : undefined;
  if (options.signal?.aborted) onAbort(); else options.signal?.addEventListener('abort', onAbort, { once: true });
  const gone = new Promise<Refusal>((resolve) => ctl.signal.addEventListener('abort', () => resolve(stopped!), { once: true }));

  let reservation: { reservationId?: string } = {};
  let recorded = 0, reserved = false;
  const record = async (charge: Charge) => {
    const usageId = `${runId}:${++recorded}`;
    if (sink) await sink.recordUsage({ ...scope, ...reservation, usageId, bucket: charge.bucket, usage: charge.usage, amountMicros: charge.amountMicros });
  };
  async function run(): Promise<(T & Answered) | Refusal> {
    if (sink) {
      const held = await sink.reserveRun({ ...scope, kind: 'input', message: '', content: null }).catch((): MeteringReservation => ({ kind: 'refused', reason: 'meter' }));
      if ('kind' in held) return refuse(held.reason, false);
      reservation = held;
      reserved = true;
    }
    let down = false;
    for (const name of names) {
      if (ctl.signal.aborted) break;
      const provider = table[name]!;
      const key = provider.key ? options.keys?.[provider.key] : undefined;
      if (provider.key && (typeof key !== 'string' || !key)) continue;
      try {
        const answer = await send(provider, key as string | undefined, ctl.signal, record);
        if (isRefusal(answer)) return answer;
        return { ...answer, ok: true, provider: provider.name, region: provider.region, counted: Boolean(sink) };
      } catch { down = true; }
    }
    return stopped ?? (down ? refuse('unavailable', true) : refuse(`${need}-failed`, false));
  }
  const settle = async (result: (T & Answered) | Refusal) => {
    if (!sink || !reserved) return;
    const status = result.ok ? 'done' : recorded ? 'unanswered' : undefined;
    try {
      if (status) await sink.settleRun({ ...scope, ...reservation, status });
      else await sink.releaseRun({ ...scope, ...reservation, reason: 'error-before-usage' });
    } catch { /* the run stays open in the ledger; Meter.recover finishes it */ }
  };
  const work = run().then(async (result) => { await settle(result); return result; });
  try { return await Promise.race([work, gone]); } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); }
}
