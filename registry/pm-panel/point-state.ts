import type { SpeechSegment } from '@hachej/boring-feedback/page';

export interface PointChip {
  readonly id: string;
  readonly number: number;
  readonly kind: string;
  readonly label: string;
  readonly screen: string;
  /** Seconds from this recording's first audio sample, not a wall clock. */
  readonly at: number;
  readonly box: readonly [number, number, number, number];
  readonly capture?: { readonly mimeType: string; readonly data: string };
}

export interface PointState {
  readonly mode: 'point' | 'navigate' | 'full';
  readonly show: boolean;
  readonly chips: readonly PointChip[];
  readonly nextNumber: number;
  readonly dock: 'top' | 'bottom';
}

export type PointEvent =
  | { readonly type: 'show'; readonly value: boolean }
  | { readonly type: 'return' | 'full' | 'collapse' | 'sent' }
  | { readonly type: 'pick'; readonly chip: Omit<PointChip, 'number'>; readonly viewportHeight: number; readonly bottomInset: number }
  | { readonly type: 'remove'; readonly id: string };

/** Local presentation only; routing and the borrowed composer's recording lifecycle stay with their owners. */
export function createPointState(): PointState {
  return { mode: 'point', show: false, chips: [], nextNumber: 1, dock: 'bottom' };
}

export function pointReducer(state: PointState, event: PointEvent): PointState {
  switch (event.type) {
    case 'show': return { ...state, show: event.value, mode: event.value ? 'point' : 'navigate' };
    case 'return':
    case 'collapse': return { ...state, mode: 'point' };
    case 'full': return { ...state, mode: 'full' };
    case 'remove': return { ...state, chips: state.chips.filter(chip => chip.id !== event.id) };
    case 'sent': return { ...createPointState(), mode: 'full', show: state.show };
    case 'pick': {
      const chip: PointChip = { ...event.chip, box: [...event.chip.box], number: state.nextNumber,
        ...(event.chip.capture ? { capture: { ...event.chip.capture } } : {}) };
      return { ...state, chips: [...state.chips, chip], nextNumber: state.nextNumber + 1,
        dock: chip.box[1] + chip.box[3] >= event.viewportHeight - event.bottomInset - 160 ? 'top' : 'bottom' };
    }
  }
}

export function marker(number: number): string {
  if (Number.isInteger(number) && number >= 1 && number <= 20) return String.fromCodePoint(0x2460 + number - 1);
  if (Number.isInteger(number) && number >= 21 && number <= 35) return String.fromCodePoint(0x3251 + number - 21);
  if (Number.isInteger(number) && number >= 36 && number <= 50) return String.fromCodePoint(0x32b1 + number - 36);
  return `(${number})`;
}

interface TranscriptBoundary { readonly at: number; readonly offset: number }
const timed = (span: { readonly start: number; readonly end: number }): boolean =>
  Number.isFinite(span.start) && Number.isFinite(span.end) && span.start >= 0 && span.end >= span.start;

/** Only exact matches in the canonical transcript establish offsets; timed segment text is never appended a second time. */
function transcriptBoundaries(text: string, segments: readonly SpeechSegment[]): readonly TranscriptBoundary[] {
  const boundaries: TranscriptBoundary[] = [];
  let cursor = 0;
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const value = segment.text.trim();
    if (!timed(segment) || !value) continue;
    const start = text.indexOf(value, cursor);
    if (start < 0) continue;
    const end = start + value.length;
    boundaries.push({ at: segment.start, offset: start }, { at: segment.end, offset: end });
    let wordCursor = start;
    for (const word of segment.words ?? []) {
      const value = word.text.trim();
      if (!timed(word) || word.start < segment.start || word.end > segment.end || !value) continue;
      const offset = text.indexOf(value, wordCursor);
      if (offset < 0 || offset + value.length > end) continue;
      boundaries.push({ at: word.start, offset }, { at: word.end, offset: offset + value.length });
      wordCursor = offset + value.length;
    }
    cursor = end;
  }
  return boundaries;
}

/** Timings place markers at the nearest proven boundary. Without usable timing the markers follow the text, not an invented alignment. */
export function alignedTranscript(text: string, segments: readonly SpeechSegment[] | undefined, chips: readonly PointChip[]): string {
  const boundaries = transcriptBoundaries(text, segments ?? []);
  const insertions = new Map<number, string[]>();
  for (const chip of [...chips].sort((a, b) => a.at - b.at || a.number - b.number)) {
    let nearest: TranscriptBoundary | undefined;
    if (Number.isFinite(chip.at)) {
      for (const boundary of boundaries) {
        if (!nearest || Math.abs(boundary.at - chip.at) < Math.abs(nearest.at - chip.at)) nearest = boundary;
      }
    }
    const offset = nearest?.offset ?? text.length;
    const values = insertions.get(offset) ?? [];
    values.push(marker(chip.number));
    insertions.set(offset, values);
  }
  let result = '', cursor = 0;
  for (const [offset, values] of [...insertions].sort(([a], [b]) => a - b)) {
    result += text.slice(cursor, offset);
    const before = offset > 0 && !/\s/u.test(text[offset - 1]!) ? ' ' : '';
    const after = offset < text.length && !/[\s.,;:!?…)\]}>]/u.test(text[offset]!) ? ' ' : '';
    result += `${before}${values.join(' ')}${after}`;
    cursor = offset;
  }
  return result + text.slice(cursor);
}
