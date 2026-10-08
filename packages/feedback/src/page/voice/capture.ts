// Voice capture for a feedback session: the person's microphone recorded while they point, with the page-clock time of the first
// recorded sample so speech can be aligned with the pointer (./align.ts).
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
export interface VoiceCapture {
  readonly start: () => Promise<VoiceStart>;
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
}

export const DEFAULT_MAX_VOICE_MS = 5 * 60_000;
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

  const finish = (current: Session, truncated: boolean): void => {
    if (current.timer !== null) { clearTimeout(current.timer); current.timer = null; }
    if (truncated) current.truncated = true;
    if (current.recorder.state !== 'inactive') { try { current.recorder.stop(); } catch { /* already stopping */ } }
  };

  return {
    async start() {
      if (session || opening) return { kind: 'refused', code: 'failed', reason: 'Already recording.' };
      const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
      const open = options.getUserMedia ?? browserGetUserMedia();
      // No media devices on an insecure origin: say that, not "no microphone" (the person can fix the address, not the hardware).
      if (!open) return refused(plainHttpPage() ? 'insecure' : 'unsupported');
      if (typeof Recorder !== 'function') return refused('unsupported', 'no MediaRecorder');
      // getUserMedia is called synchronously from here, inside the person's click (no await before it), so browsers that tie the
      // permission prompt to a user gesture show it.
      opening = true;
      cancelledWhileOpening = false;
      let stream: MediaStream;
      try { stream = await open({ audio: true }); }
      catch (error) { opening = false; return refusalOf(error); }
      if (cancelledWhileOpening) { opening = false; release(stream); return { kind: 'refused', code: 'failed', reason: 'Cancelled before the microphone opened.' }; }
      const supported = (type: string): boolean => { try { return typeof Recorder.isTypeSupported !== 'function' || Recorder.isTypeSupported(type); } catch { return false; } };
      const preferred = VOICE_MIME_TYPES.find(supported);
      let recorder: MediaRecorder;
      try { recorder = preferred ? new Recorder(stream, { mimeType: preferred }) : new Recorder(stream); }
      catch (error) { opening = false; release(stream); return refused('unsupported', error instanceof Error ? error.message : String(error)); }
      let settle!: () => void;
      const current: Session = {
        stream, recorder, mimeType: preferred ?? '', chunks: [], startedAt: null, stoppedAt: null, truncated: false, timer: null,
        stopped: new Promise<void>(resolve => { settle = resolve; }), cancelled: false,
      };
      recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size > 0) current.chunks.push(event.data); });
      recorder.addEventListener('stop', () => { current.stoppedAt = now(); release(stream); settle(); });
      recorder.addEventListener('error', () => { current.stoppedAt ??= now(); release(stream); settle(); });
      try { current.startedAt = now(); recorder.start(1000); }
      catch (error) { opening = false; release(stream); return refused('failed', error instanceof Error ? error.message : String(error)); }
      if (Number.isFinite(maxMs) && maxMs > 0) current.timer = setTimeout(() => finish(current, true), maxMs);
      session = current;
      opening = false;
      return { kind: 'recording' };
    },
    async stop() {
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
