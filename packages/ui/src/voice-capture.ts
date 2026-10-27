// Shared browser microphone capture. Chat keeps the audio; feedback also uses the page-clock time of the first recorded sample
// to align speech with the pointer.
//
// Microphone access (getUserMedia) exists only in secure contexts (https or localhost) and needs the person's permission. The
// capture never opens it on load: only `start()`, called from the person's click, does, through an injectable `getUserMedia`
// whose default feature-detects `navigator.mediaDevices.getUserMedia` and refuses with a reason when it is missing. A host that
// owns microphone policy passes its own. `npm run check` (scripts/check-platform-apis.mjs) allowlists this file on that condition.
//
// The clock. MediaRecorder hands audio over late and in chunks, so neither its `start` event nor a chunk's arrival says when the
// first recorded sample was heard. `npm run feedback:voice-sync` (tools/feedback-voice-sync.mjs) measured seven candidate
// strategies in Chromium against an independent reader of the same microphone; the page time read immediately before
// `MediaRecorder.start()` was the most accurate (2–4 ms mean, under 9 ms max over three batches, with the fake device's dropped
// time removed), while the `start` event is about 60 ms late (up to 125 ms) and stop-minus-duration 30–40 ms late. So
// `startedAt` is that time.
// `endedAt` is `startedAt` plus the decoded duration when the page can decode the recording, else the `stop` event's time.
// Measured in Chromium only; a microphone that warms up after getUserMedia resolves (no audio yet when recording starts) would
// make `startedAt` early by the warm-up.
//
// WAV first. Where the page has Web Audio, the capture records 16 kHz mono PCM WAV instead: a MediaRecorder webm carries the
// browser's clock, and one stamped at 0 s then 3900 s (23/10/2026) was refused by every OpenAI transcription model ("Audio file
// might be corrupted or unsupported"); a WAV has no timestamps, its length is its byte count. `start()` resolves only once the
// first sound arrives (a fresh AudioContext can take a second or two), so a host that shows "recording" never loses the first
// words; no sound within `firstSoundMs` refuses as `busy`. `startedAt` is the page time of that first buffer's first sample and
// `endedAt` adds the samples' duration, so the clock no longer depends on MediaRecorder's late chunks. A ScriptProcessorNode, not
// an AudioWorklet: a worklet is a module the page must serve, and a host's CSP may refuse one made from a blob. MediaRecorder
// stays the fallback where there is no AudioContext.

/** Why the microphone could not be used, for a short human message: `denied` (the person or the browser refused the permission),
 * `no-microphone`, `busy` (in use or could not be opened), `insecure` (http on a name other than localhost: no media devices at all),
 * `unsupported` (no MediaRecorder, or it cannot record this microphone), `failed` (anything else). */
export type VoiceRefusal = 'denied' | 'no-microphone' | 'busy' | 'insecure' | 'unsupported' | 'failed';
export type VoiceStart = { readonly kind: 'recording' } | { readonly kind: 'refused'; readonly reason: string; readonly code?: VoiceRefusal };
export interface VoiceRecording {
  readonly audio: Blob; readonly mimeType: string;
  /** Page time (`performance.now()` ms) of the first recorded sample. */
  readonly startedAt: number;
  readonly endedAt: number;
  /** The recording reached `maxMs` and stopped on its own. */
  readonly truncated: boolean;
}
/** Live capture facts. PCM elapsed time and level come from kept samples, never a synthetic waveform. */
export interface VoiceCaptureProgress {
  readonly elapsedMs: number;
  /** Root mean square amplitude in [0, 1]; unavailable on the MediaRecorder fallback. */
  readonly level: number | undefined;
  readonly paused: boolean;
  readonly canPause: boolean;
}
export interface VoiceCapture {
  readonly start: () => Promise<VoiceStart>;
  readonly progress: () => VoiceCaptureProgress | null;
  /** PCM only: pauses/resumes appending samples. False when unavailable or already ended. */
  readonly pause: () => boolean;
  readonly resume: () => boolean;
  /** Ends the recording and returns it; null when nothing was recorded (never started, cancelled, or empty). */
  readonly stop: () => Promise<VoiceRecording | null>;
  /** Ends the recording, releases the microphone and discards the audio. */
  readonly cancel: () => void;
}
export interface VoiceCaptureOptions {
  readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Longest recording in milliseconds (default 5 minutes); the recording stops there and `stop()` reports `truncated`. */
  readonly maxMs?: number;
  /** The page clock (default `performance.now()`). */
  readonly now?: () => number;
  /** The Web Audio context for WAV recording (default `new AudioContext()` when the page has one); `null` records with MediaRecorder. */
  readonly audioContext?: (() => AudioContext) | null;
  /** How long `start()` waits for the first sound before refusing as `busy` (default 5 s). */
  readonly firstSoundMs?: number;
}

export const DEFAULT_MAX_VOICE_MS = 5 * 60_000;
/** WAV recordings are 16 kHz mono 16-bit PCM: 32 kB per second. */
export const WAV_RATE = 16_000;

/** `input` (samples at `from` Hz) at `to` Hz, each output sample the mean of the input samples it covers. */
export function downsample(input: Float32Array, from: number, to = WAV_RATE): Float32Array {
  if (from === to) return Float32Array.from(input);
  if (from < to) throw new Error(`cannot upsample ${from} Hz to ${to} Hz`);
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** The WAV file (16-bit PCM, mono) of `chunks` of samples at `rate` Hz, end to end, clipped to [-1, 1]. */
export function encodeWav(chunks: readonly Float32Array[], rate = WAV_RATE): Uint8Array<ArrayBuffer> {
  const length = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const view = new DataView(new ArrayBuffer(44 + length * 2));
  const ascii = (at: number, text: string): void => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, length * 2, true);
  let at = 44;
  for (const chunk of chunks) for (const sample of chunk) { const v = Math.max(-1, Math.min(1, sample)); view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true); at += 2; }
  return new Uint8Array(view.buffer);
}

/** The page's Web Audio context constructor, or null (Node, old browsers). */
function browserAudioContext(): (() => AudioContext) | null {
  const Context = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return typeof Context === 'function' ? () => new Context() : null;
}
/** Container types tried in order; the first the browser records wins. */
export const VOICE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'] as const;

/** The browser's microphone, or null where the page cannot have one (insecure origin, no media devices). */
export function browserGetUserMedia(): ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null {
  if (typeof globalThis.navigator?.mediaDevices?.getUserMedia !== 'function') return null;
  const devices = globalThis.navigator.mediaDevices;
  return constraints => devices.getUserMedia(constraints);
}

/** Short human messages, one per refusal; each says what to do next. */
export const VOICE_REFUSALS: Readonly<Record<VoiceRefusal, string>> = {
  denied: 'Microphone blocked. Allow it for this site in the browser, then press Record again.',
  'no-microphone': 'No microphone found. Connect one, then press Record again.',
  busy: 'The microphone is busy or could not be opened. Close other apps using it and try again.',
  insecure: 'Recording needs a secure page (https or localhost).',
  unsupported: 'This browser cannot record audio here.',
  failed: 'The microphone could not be started.',
};

const refused = (code: VoiceRefusal, detail?: string): VoiceStart => ({ kind: 'refused', code, reason: detail ? `${VOICE_REFUSALS[code]} (${detail})` : VOICE_REFUSALS[code] });

function refusalOf(error: unknown): VoiceStart {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return refused('denied');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return refused('no-microphone');
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return refused('busy');
  return refused('failed', error instanceof Error ? error.message : String(error));
}

/** Media devices missing on a plain-http page: the usual reason is an insecure origin (http on a name that is not local; a local
 * http page has them). Wording only; the capability itself is feature-detected (`browserGetUserMedia`). */
const plainHttpPage = (): boolean => (globalThis as { location?: { protocol?: string } }).location?.protocol === 'http:';

const release = (stream: MediaStream | null): void => { for (const track of stream?.getTracks() ?? []) track.stop(); };

/** Duration in milliseconds of recorded audio, when the page can decode it (OfflineAudioContext or AudioContext). */
async function decodedMs(audio: Blob): Promise<number | null> {
  try {
    const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (typeof Offline !== 'function' || audio.size === 0) return null;
    const context = new Offline(1, 1, 48_000);
    const buffer = await context.decodeAudioData(await audio.arrayBuffer());
    return Number.isFinite(buffer.duration) ? buffer.duration * 1000 : null;
  } catch { return null; }
}

export function createVoiceCapture(options: VoiceCaptureOptions = {}): VoiceCapture {
  const now = options.now ?? (() => performance.now());
  const maxMs = options.maxMs ?? DEFAULT_MAX_VOICE_MS;
  interface Session {
    stream: MediaStream; recorder: MediaRecorder; mimeType: string; chunks: Blob[];
    startedAt: number | null; stoppedAt: number | null; truncated: boolean; timer: ReturnType<typeof setTimeout> | null;
    stopped: Promise<void>; cancelled: boolean;
  }
  let session: Session | null = null;
  let opening = false;
  let cancelledWhileOpening = false;
  const makeContext = options.audioContext === undefined ? browserAudioContext() : options.audioContext;
  const firstSoundMs = options.firstSoundMs ?? 5_000;
  interface WavSession {
    stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode | null; node: ScriptProcessorNode | null;
    chunks: Float32Array[]; samples: number; maxSamples: number; startedAt: number | null; truncated: boolean; cancelled: boolean; ended: boolean; paused: boolean; level: number;
    cancel: () => void;
  }
  let wav: WavSession | null = null;

  /** Stops capturing (the samples so far are kept), releases the microphone and closes the context. */
  const endWav = (current: WavSession, truncated: boolean): void => {
    if (truncated) current.truncated = true;
    if (current.ended) return;
    current.ended = true;
    if (current.node) { current.node.onaudioprocess = null; current.node.disconnect(); }
    current.source?.disconnect();
    release(current.stream);
    void current.context.close().catch(() => {});
  };

  /** MediaRecorder on an open microphone (`startedAt` read just before `start()`, see the clock above). */
  function record(Recorder: typeof MediaRecorder, stream: MediaStream): VoiceStart {
    const supported = (type: string): boolean => { try { return typeof Recorder.isTypeSupported !== 'function' || Recorder.isTypeSupported(type); } catch { return false; } };
    const preferred = VOICE_MIME_TYPES.find(supported);
    let recorder: MediaRecorder;
    try { recorder = preferred ? new Recorder(stream, { mimeType: preferred }) : new Recorder(stream); }
    catch (error) { release(stream); return refused('unsupported', error instanceof Error ? error.message : String(error)); }
    let settle!: () => void;
    const current: Session = {
      stream, recorder, mimeType: preferred ?? '', chunks: [], startedAt: null, stoppedAt: null, truncated: false, timer: null,
      stopped: new Promise<void>(resolve => { settle = resolve; }), cancelled: false,
    };
    recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size > 0) current.chunks.push(event.data); });
    recorder.addEventListener('stop', () => { current.stoppedAt = now(); release(stream); settle(); });
    recorder.addEventListener('error', () => { current.stoppedAt ??= now(); release(stream); settle(); });
    try { current.startedAt = now(); recorder.start(1000); }
    catch (error) { release(stream); return refused('failed', error instanceof Error ? error.message : String(error)); }
    if (Number.isFinite(maxMs) && maxMs > 0) current.timer = setTimeout(() => finish(current, true), maxMs);
    session = current;
    return { kind: 'recording' };
  }

  /** WAV through Web Audio: the context is made and resumed inside the person's click, before awaiting the microphone. */
  async function startWav(makeContext: () => AudioContext, open: (constraints: MediaStreamConstraints) => Promise<MediaStream>, Recorder: typeof MediaRecorder | null): Promise<VoiceStart> {
    opening = true;
    cancelledWhileOpening = false;
    let context: AudioContext;
    try { context = makeContext(); }
    catch (error) { opening = false; return refused('unsupported', error instanceof Error ? error.message : String(error)); }
    const resuming = context.resume().catch(() => {});
    let stream: MediaStream;
    try { stream = await open({ audio: true }); }
    catch (error) { opening = false; void context.close().catch(() => {}); return refusalOf(error); }
    let cancelled!: () => void;
    const current: WavSession = {
      stream, context, source: null, node: null, chunks: [], samples: 0, startedAt: null, truncated: false, cancelled: false, ended: false, paused: false, level: 0,
      maxSamples: Number.isFinite(maxMs) && maxMs > 0 ? Math.floor((maxMs / 1000) * WAV_RATE) : Number.POSITIVE_INFINITY,
      cancel: () => cancelled(),
    };
    const gone = new Promise<'cancelled'>(resolve => { cancelled = () => resolve('cancelled'); });
    if (cancelledWhileOpening) { opening = false; endWav(current, false); return { kind: 'refused', code: 'failed', reason: 'Cancelled before the microphone opened.' }; }
    // A context the browser keeps suspended (no user activation: a press-and-hold begun on touchstart, which is not one) records
    // nothing: that take is recorded by MediaRecorder on the microphone already open, as before WAV.
    await Promise.race([resuming, new Promise(resolve => setTimeout(resolve, 500))]);
    if (cancelledWhileOpening) { opening = false; endWav(current, false); return { kind: 'refused', code: 'failed', reason: 'Cancelled before the microphone opened.' }; }
    if (context.state !== 'running') {
      void context.close().catch(() => {});
      opening = false;
      if (Recorder) return record(Recorder, stream);
      release(stream);
      return refused('unsupported', 'audio is not allowed to start here');
    }
    let heard!: () => void;
    const sound = new Promise<'heard'>(resolve => { heard = () => resolve('heard'); });
    try {
      current.source = context.createMediaStreamSource(stream);
      current.node = context.createScriptProcessor(4096, 1, 1);
    } catch (error) { opening = false; endWav(current, false); return refused('unsupported', error instanceof Error ? error.message : String(error)); }
    current.node.onaudioprocess = event => {
      if (current.ended || current.paused) return;
      const input = event.inputBuffer.getChannelData(0);
      if (current.startedAt === null) { current.startedAt = now() - (input.length / context.sampleRate) * 1000; heard(); }
      const chunk = downsample(input, context.sampleRate);
      const room = current.maxSamples - current.samples;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      let squares = 0;
      for (const sample of kept) squares += sample * sample;
      current.level = kept.length ? Math.min(1, Math.sqrt(squares / kept.length)) : 0;
      current.chunks.push(kept);
      current.samples += kept.length;
      if (current.samples >= current.maxSamples) endWav(current, true);
    };
    current.source.connect(current.node);
    current.node.connect(context.destination);
    wav = current;
    opening = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const silent = new Promise<'silent'>(resolve => { timer = setTimeout(() => resolve('silent'), firstSoundMs); });
    const outcome = await Promise.race([sound, silent, gone]);
    clearTimeout(timer);
    if (outcome === 'heard') return { kind: 'recording' };
    if (wav === current) wav = null;
    endWav(current, false);
    return outcome === 'cancelled'
      ? { kind: 'refused', code: 'failed', reason: 'Cancelled before the microphone opened.' }
      : refused('busy', 'no sound from the microphone');
  }

  const finish = (current: Session, truncated: boolean): void => {
    if (current.timer !== null) { clearTimeout(current.timer); current.timer = null; }
    if (truncated) current.truncated = true;
    if (current.recorder.state !== 'inactive') { try { current.recorder.stop(); } catch { /* already stopping */ } }
  };

  return {
    progress() {
      if (wav) return { elapsedMs: wav.samples / WAV_RATE * 1000, level: wav.level, paused: wav.paused, canPause: !wav.ended && wav.startedAt !== null };
      if (!session || session.startedAt === null) return null;
      return { elapsedMs: Math.min(Math.max(0, (session.stoppedAt ?? now()) - session.startedAt), maxMs > 0 ? maxMs : Infinity), level: undefined, paused: false, canPause: false };
    },
    pause() { if (!wav || wav.ended || wav.startedAt === null) return false; wav.paused = true; return true; },
    resume() { if (!wav || wav.ended || wav.startedAt === null) return false; wav.paused = false; return true; },
    async start() {
      if (session || wav || opening) return { kind: 'refused', code: 'failed', reason: 'Already recording.' };
      const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
      const open = options.getUserMedia ?? browserGetUserMedia();
      // No media devices on an insecure origin: say that, not "no microphone" (the person can fix the address, not the hardware).
      if (!open) return refused(plainHttpPage() ? 'insecure' : 'unsupported');
      if (makeContext) return startWav(makeContext, open, typeof Recorder === 'function' ? Recorder : null);
      if (typeof Recorder !== 'function') return refused('unsupported', 'no MediaRecorder');
      // getUserMedia is called synchronously from here, inside the person's click (no await before it), so browsers that tie the
      // permission prompt to a user gesture show it.
      opening = true;
      cancelledWhileOpening = false;
      let stream: MediaStream;
      try { stream = await open({ audio: true }); }
      catch (error) { opening = false; return refusalOf(error); }
      if (cancelledWhileOpening) { opening = false; release(stream); return { kind: 'refused', code: 'failed', reason: 'Cancelled before the microphone opened.' }; }
      opening = false;
      return record(Recorder, stream);
    },
    async stop() {
      const recorded = wav;
      if (recorded) {
        wav = null;
        endWav(recorded, false);
        if (recorded.cancelled || recorded.samples === 0 || recorded.startedAt === null) return null;
        const audio = new Blob([encodeWav(recorded.chunks)], { type: 'audio/wav' });
        const endedAt = recorded.startedAt + (recorded.samples / WAV_RATE) * 1000;
        return { audio, mimeType: 'audio/wav', startedAt: recorded.startedAt, endedAt, truncated: recorded.truncated };
      }
      const current = session;
      if (!current) return null;
      finish(current, false);
      await current.stopped;
      session = null;
      if (current.cancelled) return null;
      const mimeType = current.recorder.mimeType || current.mimeType || current.chunks[0]?.type || 'audio/webm';
      const audio = new Blob(current.chunks, { type: mimeType });
      if (audio.size === 0) return null;
      const startedAt = current.startedAt ?? current.stoppedAt ?? now();
      const duration = await decodedMs(audio);
      const endedAt = duration === null ? Math.max(startedAt, current.stoppedAt ?? now()) : startedAt + duration;
      return { audio, mimeType, startedAt, endedAt, truncated: current.truncated };
    },
    cancel() {
      const recorded = wav;
      if (recorded) { wav = null; recorded.cancelled = true; recorded.chunks.length = 0; endWav(recorded, false); recorded.cancel(); }
      const current = session;
      if (opening) cancelledWhileOpening = true;
      if (!current) return;
      session = null;
      current.cancelled = true;
      current.chunks.length = 0;
      finish(current, false);
      release(current.stream);
    },
  };
}
