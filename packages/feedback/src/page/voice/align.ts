// Voice and pointer alignment: what a person says while pointing at an element attaches to that element.
//
// One clock for everything: `performance.now()` milliseconds of the page. Transcription segments are in seconds from the first
// audio sample; `audioStartedAt` (from `VoiceCapture.stop`) puts that sample on the page clock. Pure: no DOM, no timers.
//
// The rule, applied to each segment (or to each word group, see below):
// 1. The segment covers the page-time window [a, b] = [audioStartedAt + start × 1000, audioStartedAt + end × 1000].
// 2. Pin: a pin placed inside [a, b] wins (the earliest one). Otherwise a pin placed in the second after the segment wins
//    (b, b + PIN_AFTER_MS], unless the next segment has already started, so a pin follows "this one is wrong" said just
//    before the click but never steals the next sentence's pin. Confidence 'pin'.
// 3. Dwell: otherwise the element the pointer stayed over longest inside [a, b] (ties: the one reached first). Confidence 'dwell'.
//    Pointer samples are change points: a sample holds until the next one, the last one holds on. Before the first sample the
//    pointer is unknown, as over nothing. The session must send `{ target: null }` when the pointer leaves the page or crosses
//    something not pickable, or a gap reads as dwelling on the last element.
// 4. Narration: the pointer over nothing for the whole window (and no pin) gives target null, confidence 'none'.
// 5. Word timings: when a segment carries `words`, it is split where the pointer moves to another element (each word placed by
//    the dwell over its own time; words over nothing stay with the group before them), and each group gets rules 2–4 on its own
//    window. Without word timings a segment is never split.
//
// The clock was measured, not assumed: `npm run feedback:voice-sync` (tools/feedback-voice-sync.mjs) records beeps in headless
// Chromium while the pointer moves; the chosen `startedAt` was within 9 ms of an independent reader of the microphone (see
// .cache/evidence/feedback-voice/RESULT.md), far below the 150 ms target and a segment's own length, so no window is widened.

export interface SpeechWord { readonly start: number; readonly end: number; readonly text: string }
/** Seconds from the audio start. `words`, when the transcription gives word timings, lets a segment split at pointer changes. */
export interface SpeechSegment { readonly start: number; readonly end: number; readonly text: string; readonly words?: readonly SpeechWord[] }
/** `t` on the page clock; `target` an index into the session's element list, or null over nothing pickable. */
export interface PointerSample { readonly t: number; readonly target: number | null }
export interface PinMark { readonly t: number; readonly target: number }
export interface AlignedSpeech { readonly target: number | null; readonly text: string; readonly at: number; readonly confidence: 'dwell' | 'pin' | 'none' }

/** How long after a segment ends a pin still claims it (milliseconds). */
export const PIN_AFTER_MS = 1000;

interface Span { readonly a: number; readonly b: number; readonly text: string; readonly start: number }

const finite = (value: number): boolean => typeof value === 'number' && Number.isFinite(value);

/** Milliseconds the pointer spent over each element inside [a, b], with the time each was first reached there. */
function dwell(pointer: readonly PointerSample[], a: number, b: number): Map<number, { ms: number; first: number }> {
  const out = new Map<number, { ms: number; first: number }>();
  for (let i = 0; i < pointer.length; i++) {
    const sample = pointer[i]!;
    const from = Math.max(a, sample.t);
    const next = i + 1 < pointer.length ? pointer[i + 1]!.t : Infinity;
    const until = Math.min(b, next);
    // A zero-length window (a word or segment with no duration) takes the sample holding at that instant.
    const holds = a === b ? sample.t <= a && next > a : until > from;
    if (sample.target === null || !holds) continue;
    const seen = out.get(sample.target);
    if (seen) seen.ms += until - from; else out.set(sample.target, { ms: until - from, first: from });
  }
  return out;
}

function dwellTarget(pointer: readonly PointerSample[], a: number, b: number): number | null {
  let best: number | null = null, bestMs = -1, bestFirst = Infinity;
  for (const [target, { ms, first }] of dwell(pointer, a, b)) {
    if (ms > bestMs || (ms === bestMs && first < bestFirst)) { best = target; bestMs = ms; bestFirst = first; }
  }
  return best;
}

function pinTarget(pins: readonly PinMark[], a: number, b: number, nextStart: number): number | null {
  let inside: PinMark | null = null, after: PinMark | null = null;
  const limit = Math.min(b + PIN_AFTER_MS, Math.max(b, nextStart));
  for (const pin of pins) {
    if (pin.t >= a && pin.t <= b) { if (!inside || pin.t < inside.t) inside = pin; }
    else if (pin.t > b && pin.t <= limit) { if (!after || pin.t < after.t) after = pin; }
  }
  return (inside ?? after)?.target ?? null;
}

/** Word groups of one segment: consecutive words over the same element; words over nothing join the group before them. */
function groups(segment: SpeechSegment, base: number, pointer: readonly PointerSample[]): Span[] | null {
  const words = (segment.words ?? []).filter(word => finite(word.start) && finite(word.end) && word.text.trim());
  if (words.length < 2) return null;
  const out: { target: number | null; words: SpeechWord[] }[] = [];
  for (const word of words) {
    const target = dwellTarget(pointer, base + word.start * 1000, base + Math.max(word.start, word.end) * 1000);
    const last = out[out.length - 1];
    if (last && (target === null || target === last.target)) last.words.push(word);
    else if (last && last.target === null) { last.target = target; last.words.push(word); }
    else out.push({ target, words: [word] });
  }
  if (out.length < 2) return null;
  return out.map(group => {
    const first = group.words[0]!, last = group.words[group.words.length - 1]!;
    return { a: base + first.start * 1000, b: base + Math.max(first.start, last.end) * 1000, start: first.start, text: group.words.map(word => word.text.trim()).join(' ') };
  });
}

export function alignSpeech(input: {
  readonly segments: readonly SpeechSegment[]; readonly audioStartedAt: number; readonly pointer: readonly PointerSample[]; readonly pins: readonly PinMark[];
}): readonly AlignedSpeech[] {
  const base = input.audioStartedAt;
  if (!finite(base)) return [];
  const pointer = input.pointer.filter(sample => finite(sample.t)).slice().sort((x, y) => x.t - y.t);
  const pins = input.pins.filter(pin => finite(pin.t));
  const spans: Span[] = [];
  for (const segment of input.segments) {
    if (!finite(segment.start) || !finite(segment.end) || !segment.text.trim()) continue;
    const split = groups(segment, base, pointer);
    if (split) spans.push(...split);
    else spans.push({ a: base + segment.start * 1000, b: base + Math.max(segment.start, segment.end) * 1000, start: segment.start, text: segment.text.trim() });
  }
  spans.sort((x, y) => x.a - y.a);
  return spans.map((span, i) => {
    const next = spans.slice(i + 1).find(other => other.a > span.a)?.a ?? Infinity;
    const pinned = pinTarget(pins, span.a, span.b, next);
    if (pinned !== null) return { target: pinned, text: span.text, at: span.a, confidence: 'pin' as const };
    const target = dwellTarget(pointer, span.a, span.b);
    return target === null ? { target: null, text: span.text, at: span.a, confidence: 'none' as const } : { target, text: span.text, at: span.a, confidence: 'dwell' as const };
  });
}
