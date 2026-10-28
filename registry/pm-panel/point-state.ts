import type { SpeechSegment } from '@hachej/boring-feedback/page';

export interface PointChip {
  readonly id: string;
  readonly number: number;
  readonly kind: string;
  readonly label: string;
  readonly screen: string;
  /** Seconds of recorded time at the tap (pauses excluded), or `null` when nothing was recording (picked in `point.idle`). */
  readonly at: number | null;
  readonly box: readonly [number, number, number, number];
  readonly capture?: { readonly mimeType: string; readonly data: string };
}

export interface PointState {
  readonly mode: 'sheet' | 'point' | 'navigate' | 'full';
  readonly show: boolean;
  readonly chips: readonly PointChip[];
  readonly nextNumber: number;
}

export type PointEvent =
  | { readonly type: 'show'; readonly value: boolean }
  | { readonly type: 'point' }
  | { readonly type: 'return' | 'full' | 'collapse' }
  | { readonly type: 'pick'; readonly chip: Omit<PointChip, 'number'> }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'sent'; readonly ids?: readonly string[] };

/** Local presentation only; routing and the borrowed composer's recording lifecycle stay with their owners. */
export function createPointState(): PointState {
  return { mode: 'sheet', show: false, chips: [], nextNumber: 1 };
}

export function pointReducer(state: PointState, event: PointEvent): PointState {
  switch (event.type) {
    case 'show': return { ...state, show: event.value, mode: event.value ? 'point' : 'navigate' };
    // « Montrer »: the strip in select mode; recording is the microphone's, never this event's.
    case 'point': return { ...state, show: true, mode: 'point' };
    case 'return':
    case 'collapse': return { ...state, mode: 'sheet', show: false };
    case 'full': return { ...state, mode: 'full' };
    case 'remove': {
      // Pins, chips and markers stay in order: everything after the removed pick moves down by one.
      const gone = state.chips.find(chip => chip.id === event.id);
      if (!gone) return state;
      const chips = state.chips.filter(chip => chip.id !== event.id).map(chip => chip.number > gone.number ? { ...chip, number: chip.number - 1 } : chip);
      return { ...state, chips, nextNumber: state.nextNumber - 1 };
    }
    case 'sent': {
      const chips = event.ids ? state.chips.filter(chip => !event.ids!.includes(chip.id)) : [];
      return { ...state, mode: 'full', show: false, chips, nextNumber: chips.length ? state.nextNumber : 1 };
    }
    case 'pick': {
      const chip: PointChip = { ...event.chip, box: [...event.chip.box], number: state.nextNumber,
        ...(event.chip.capture ? { capture: { ...event.chip.capture } } : {}) };
      return { ...state, chips: [...state.chips, chip], nextNumber: state.nextNumber + 1 };
    }
  }
}

/** Splits a draft into text and marker tokens (kept by `split`). */
export const MARKER_PATTERN = /([①-⑳㉑-㉟㊱-㊿]|\(\d+\))/u;

/** The draft after removing pick `removed`: its marker goes, later markers move down by one, like the pins. */
export function renumberText(text: string, removed: number): string {
  return text.split(MARKER_PATTERN).map(part => {
    const n = numberOf(part);
    if (n === undefined) return part;
    return n === removed ? '' : n > removed ? marker(n - 1) : part;
  }).join('').replace(/ {2,}/g, ' ').replace(/ ([.,;:!?…])/gu, '$1');
}
function numberOf(part: string): number | undefined {
  const code = part.codePointAt(0) ?? 0;
  if (part.length === 1 && code >= 0x2460 && code <= 0x2473) return code - 0x2460 + 1;
  if (part.length === 1 && code >= 0x3251 && code <= 0x325f) return code - 0x3251 + 21;
  if (part.length === 1 && code >= 0x32b1 && code <= 0x32bf) return code - 0x32b1 + 36;
  const match = /^\((\d+)\)$/.exec(part);
  return match ? Number(match[1]) : undefined;
}

export function marker(number: number): string {
  if (Number.isInteger(number) && number >= 1 && number <= 20) return String.fromCodePoint(0x2460 + number - 1);
  if (Number.isInteger(number) && number >= 21 && number <= 35) return String.fromCodePoint(0x3251 + number - 21);
  if (Number.isInteger(number) && number >= 36 && number <= 50) return String.fromCodePoint(0x32b1 + number - 36);
  return `(${number})`;
}

const timed = (span: { readonly start: number; readonly end: number }): boolean =>
  Number.isFinite(span.start) && Number.isFinite(span.end) && span.start >= 0 && span.end >= span.start;
const TRAILING = /[.,;:!?…»)\]]+$/u;

/** Where each spoken word (or segment, without word timings) ends in the canonical text: only exact matches count, nothing is appended twice. */
function wordEnds(text: string, segments: readonly SpeechSegment[]): readonly { readonly at: number; readonly offset: number }[] {
  const ends: { at: number; offset: number }[] = [];
  let cursor = 0;
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const value = segment.text.trim();
    if (!timed(segment) || !value) continue;
    const start = text.indexOf(value, cursor);
    if (start < 0) continue;
    const end = start + value.length;
    let wordCursor = start, words = 0;
    for (const word of segment.words ?? []) {
      const spoken = word.text.trim();
      if (!timed(word) || word.start < segment.start || word.end > segment.end || !spoken) continue;
      const offset = text.indexOf(spoken, wordCursor);
      if (offset < 0 || offset + spoken.length > end) continue;
      // Snapped to the word: a chip goes after « jauge », before its « . ».
      const punctuation = TRAILING.exec(spoken)?.[0].length ?? 0;
      ends.push({ at: word.end, offset: offset + spoken.length - (punctuation < spoken.length ? punctuation : 0) });
      wordCursor = offset + spoken.length; words++;
    }
    if (!words) ends.push({ at: segment.end, offset: end - (TRAILING.exec(value)?.[0].length ?? 0) });
    cursor = end;
  }
  return ends;
}

/**
 * Spec 1 §4: each pick with a time goes after the last word that ends at or before it; picks without a time (`point.idle`) go first,
 * in order. Without usable timing the markers follow the text, in order, rather than an invented alignment.
 */
export function alignedTranscript(text: string, segments: readonly SpeechSegment[] | undefined, chips: readonly PointChip[]): string {
  const ends = wordEnds(text, segments ?? []);
  const insertions = new Map<number, string[]>();
  for (const chip of [...chips].sort((a, b) => (a.at ?? -1) - (b.at ?? -1) || a.number - b.number)) {
    let offset: number;
    if (chip.at === null) offset = 0;
    else if (!ends.length) offset = text.length;
    else offset = ends.filter(end => end.at <= chip.at!).reduce((best, end) => Math.max(best, end.offset), 0);
    const values = insertions.get(offset) ?? [];
    values.push(marker(chip.number));
    insertions.set(offset, values);
  }
  let result = '', cursor = 0;
  for (const [offset, values] of [...insertions].sort(([a], [b]) => a - b)) {
    result += text.slice(cursor, offset);
    const before = offset > 0 && !/\s/u.test(text[offset - 1]!) ? ' ' : '';
    const after = offset < text.length && !/[\s.,;:!?…)\]}>»]/u.test(text[offset]!) ? ' ' : '';
    result += `${before}${values.join(' ')}${after}`;
    cursor = offset;
  }
  return result + text.slice(cursor);
}
