// The feedback session (FEEDBACK.md, "UX"): one entry point, **Feedback**, in the chat composer. Pressing it enters feedback mode on the
// application page. The person hovers (the picker's box and label), clicks to drop a numbered pin and types a note in a bubble beside
// it (Enter saves, Esc discards the pin); the click never reaches the page (the picker's event blocking). Holding ⌥/Alt, or the "Use
// app" toggle, suspends the picker so clicks and keys reach the app; those interactions are recorded as steps between the notes
// (element labels through the privacy policy, route templates, named keys only). An optional voice recording is transcribed on Done
// and aligned with the pointer trail and the pins (`alignSpeech`), on ONE clock (`performance.now()`). While recording, a click drops
// a numbered pin WITHOUT the bubble: what the person says around that moment becomes its note (the pin wins in `alignSpeech`); a pin
// nothing was said about stays as an empty note to type into in the review. Done closes feedback mode and
// leaves one draft for the composer's chip: notes in order, editable and removable, each able to highlight its element; Send
// attaches the `feedback@1` report (saved first when the host has a store).
//
// Headless and framework-light like the rest of `./ui`: `subscribe`/`getSnapshot`, no view-layer import. The bar, bubble, chip and
// review are registry components over this state.
import {
  FEEDBACK_LIMITS, draftReport, feedbackText,
  type FeedbackAnchor, type FeedbackDraft, type FeedbackNote, type FeedbackStep, type HostObserved,
} from '../format/index.js';
import {
  alignSpeech, anchorOf, createOverlay, createPicker, isExcluded, pickRefusal, pickerLabel, routeFor, serializePage,
  type Picker, type PickerOverlay, type PinMark, type PointerSample, type SpeechSegment, type VoiceCapture, type VoiceRecording, type VoiceRefusal,
} from '../page/index.js';
import { copyToClipboard } from '@hachej/boring-files/platform';
import { draftId, observePage, operationId, type AnnotateHost, type CopyState } from './annotate.js';
import type { SaveEndpoint, SaveResult } from './save.js';
import { createState, type ExternalState } from './state.js';

/**
 * What the host's transcription answers. `segments` (times in seconds from the start of the audio, optionally with word timings)
 * let speech be aligned with the pointer and the pins; without them `text` becomes the general note.
 */
export interface TranscribeResult { readonly text: string; readonly segments?: readonly SpeechSegment[] }
/**
 * Transcription is a host capability, not part of this library: the host passes any function from the recorded audio to text
 * (its own server route, a shared service, a provider SDK). The session never checks a provider's schema beyond reading these
 * fields: extra fields are ignored, missing or malformed ones are tolerated, and an answer with neither usable segments nor text
 * is reported as "could not be transcribed" with the pins kept.
 */
export type Transcribe = (audio: Blob, mimeType: string) => Promise<TranscribeResult>;

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const timedText = (value: unknown): { start: number; end: number; text: string } | null => {
  const item = value as { start?: unknown; end?: unknown; text?: unknown } | null;
  if (!item || typeof item !== 'object' || !finiteNumber(item.start) || !finiteNumber(item.end) || typeof item.text !== 'string') return null;
  return { start: item.start, end: item.end, text: item.text };
};

/** The host's answer read leniently: usable timed segments, else plain text, else null (nothing usable came back). */
function readTranscription(answer: unknown): { readonly segments: readonly SpeechSegment[] } | { readonly text: string } | null {
  if (!answer || typeof answer !== 'object') return null;
  const { segments, text } = answer as { segments?: unknown; text?: unknown };
  const timed: SpeechSegment[] = (Array.isArray(segments) ? segments : []).flatMap(raw => {
    const segment = timedText(raw);
    if (!segment || !segment.text.trim()) return [];
    const words = (raw as { words?: unknown }).words;
    const kept = (Array.isArray(words) ? words : []).flatMap(word => { const read = timedText(word); return read ? [read] : []; });
    return [kept.length ? { ...segment, words: kept } : segment];
  });
  if (timed.length) return { segments: timed };
  return typeof text === 'string' ? { text } : null;
}

export interface FeedbackSessionOptions extends AnnotateHost {
  /** Optional voice: both a capture (`createVoiceCapture()`) and the host's `transcribe` are needed for the 🎙 toggle; without
   * `transcribe` the Record button is simply not offered. */
  readonly voice?: VoiceCapture;
  readonly transcribe?: Transcribe;
  /** Optional storage: Send saves the report first (one operation id per draft across retries). */
  readonly save?: SaveEndpoint;
  /** With `save`: the `@` mention of a saved report (`id => 'feedback/<id>.md'`), so the host's mention resolver inlines it. */
  readonly mention?: (id: string) => string;
  /** Extra CSS for the overlays' shadow roots (the registry's `pickerOverlayStyles`). */
  readonly styles?: string;
  /** The one clock of pins, pointer samples and recordings. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /** Elements at a viewport point (tests); defaults to `document.elementsFromPoint`. */
  readonly hitTest?: (x: number, y: number) => readonly Element[];
  /** Defaults to `copyToClipboard` from `@hachej/boring-files/platform`. */
  readonly copyText?: (text: string) => Promise<boolean>;
}

export type SessionPhase = 'idle' | 'active' | 'processing' | 'review';

export interface SessionNote {
  /** Stable for the session; never reused. */
  readonly id: number;
  /** Its number on the page and in the review (1-based, in order). */
  readonly number: number;
  readonly text: string;
  /** The privacy-policy label of its element ("SettingsPage · button «Save profile»"), or "the page" for a general note. */
  readonly label: string;
  /** The anchor's fallback, when it has an anchor. */
  readonly fallback?: string;
  /** The anchor's development source location (`src/settings/SaveBar.tsx:42`), when it has one. */
  readonly source?: string;
  readonly from?: 'voice';
  /** Pinned while recording: its note is what was said there (empty until transcribed, or when nothing was). */
  readonly recorded?: true;
}

export type VoiceState =
  | { readonly kind: 'off' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'recording' }
  /** Stop was pressed; the audio is being handed over. */
  | { readonly kind: 'stopping' }
  | { readonly kind: 'refused'; readonly reason: string; readonly code?: VoiceRefusal };

/** The note being typed in the bubble. */
export interface SessionBubble {
  readonly noteId: number;
  readonly number: number;
  readonly element: Element;
  readonly label: string;
  readonly text: string;
  /** A new pin (Esc removes it) or an existing note being edited (Esc keeps it as it was). */
  readonly fresh: boolean;
}

export type SendState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | SaveResult;

export interface FeedbackSessionSnapshot {
  readonly phase: SessionPhase;
  /** Clicks and keys reach the app (⌥ held or the "Use app" toggle). */
  readonly using: boolean;
  readonly useToggle: boolean;
  readonly notes: readonly SessionNote[];
  readonly bubble?: SessionBubble;
  /** The general note: unaligned speech, or what the person types in the review. */
  readonly general: string;
  /** The route template now (active) or when Done was pressed (review). */
  readonly route: string;
  /** How many steps were recorded between the notes. */
  readonly stepCount: number;
  readonly voice: VoiceState;
  /** Voice can be offered: the host gave both a capture and a transcription. */
  readonly voiceAvailable: boolean;
  /** Done was pressed with a recording: it is being transcribed and merged into the notes. */
  readonly transcribing: boolean;
  /** Something the person should know (a refused pin, a failed transcription), until the next action. */
  readonly problem?: string;
  readonly send: SendState;
  /** The label of the element under the pointer, from the privacy policy (active only). */
  readonly hover?: string;
  readonly copy: CopyState;
}

/** What Send puts into the message. */
export type FeedbackAttachment =
  | { readonly kind: 'mention'; readonly id: string; readonly path: string }
  | { readonly kind: 'inline'; readonly text: string }
  | { readonly kind: 'refused'; readonly reason: string };

export interface FeedbackSession extends ExternalState<FeedbackSessionSnapshot> {
  /** Enters feedback mode. */
  readonly start: () => void;
  /** Done: closes feedback mode, transcribes and aligns voice, and leaves the draft for review. */
  readonly done: () => Promise<void>;
  /** ✕: discards everything (feedback mode or the attached draft). */
  readonly discard: () => void;
  readonly setBubbleText: (text: string) => void;
  /** Enter in the bubble: keeps the note (an empty new note removes its pin). */
  readonly saveBubble: () => void;
  /** Esc in the bubble: removes a new pin, or leaves an edited note as it was. */
  readonly cancelBubble: () => void;
  /** The "Use app" toggle (touch, no ⌥). */
  readonly setUseToggle: (on: boolean) => void;
  readonly toggleVoice: () => Promise<void>;
  // Review.
  readonly setNoteText: (id: number, text: string) => void;
  readonly removeNote: (id: number) => void;
  readonly setGeneral: (text: string) => void;
  /** Hovering a note in the review: highlights its element in the page, or says it is not on this page. Undefined clears. */
  readonly highlight: (id: number | undefined) => 'shown' | 'not-on-page' | 'none';
  /** The draft the report is made from. Throws when there is nothing to send. */
  readonly draft: () => FeedbackDraft;
  /** The never-stored report text (Copy, inline). */
  readonly reportText: () => string;
  /** Copy report: the never-stored report on the clipboard. Needs no store, route or agent (FEEDBACK-2). */
  readonly copy: () => Promise<CopyState>;
  /** Send: saves first when the host has a store, then says what to put in the message. */
  readonly attach: () => Promise<FeedbackAttachment>;
  /** The message was accepted: the draft is done. */
  readonly sent: () => void;
  /** For journeys and tests: the pointer trail and pin marks so far, on the session clock. */
  readonly trail: () => { readonly pointer: readonly PointerSample[]; readonly pins: readonly PinMark[] };
  readonly dispose: () => void;
}

const NAMED_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
const MAX_ELEMENTS = 500;
const MAX_TRAIL = 5000;

/** `label` is the element's privacy-policy label when it was pinned (or spoken about), kept for when it leaves the page. */
interface NoteRecord { id: number; element?: Element; target?: number; label?: string; text: string; t: number; from?: 'voice'; recorded?: true }
type TimedStep = { readonly t: number; readonly step: FeedbackStep } | { readonly t: number; readonly noteId: number };

/** A pin number as drawn on the page: ①…⑳, then the plain number. */
export function pinMark(number: number): string {
  return number >= 1 && number <= 20 ? String.fromCodePoint(0x245f + number) : String(number);
}

export function createFeedbackSession(options: FeedbackSessionOptions): FeedbackSession {
  const { root, policy } = options;
  const now = options.now ?? (() => performance.now());
  const document = root.ownerDocument;
  const view = document.defaultView;
  const voiceAvailable = options.voice !== undefined && options.transcribe !== undefined;
  const routeNow = (): string => routeFor({ pathname: (options.location?.() ?? view?.location ?? { pathname: '/' }).pathname }, policy);

  const state = createState<FeedbackSessionSnapshot>({
    phase: 'idle', using: false, useToggle: false, notes: [], general: '', route: routeNow(), stepCount: 0,
    voice: { kind: 'off' }, voiceAvailable, transcribing: false, send: { kind: 'idle' }, copy: { kind: 'idle' },
  });

  // --- session data (reset by start) ---------------------------------------------------------------------------------------------
  let elements: Element[] = [];
  const anchors = new Map<number, FeedbackAnchor>();
  /** Each session element's label when it was last hovered or pinned, for notes about elements that later left the page. */
  const labels = new Map<number, string>();
  let notes: NoteRecord[] = [];
  let timeline: TimedStep[] = [];
  let pointer: PointerSample[] = [];
  let pins: PinMark[] = [];
  let recordings: VoiceRecording[] = [];
  let nextId = 1;
  let bubble: { noteId: number; text: string; fresh: boolean; before: string } | undefined;
  let alt = false;
  let lastRoute = '';
  let lastHover: number | null | undefined;
  let observed: HostObserved | undefined;
  let problem: string | undefined;
  let hoverLabel: string | undefined;
  // Save: one operation id per draft; kept while it may have reached the store (as in createAnnotation).
  let operation = operationId();
  let mayHaveSent = false;
  let saved: { readonly id: string } | undefined;

  let picker: Picker | undefined;
  let pinsOverlay: PickerOverlay | undefined;
  const removers: (() => void)[] = [];

  const indexOf = (element: Element): number | null => {
    const found = elements.indexOf(element);
    if (found >= 0) return found;
    if (elements.length >= MAX_ELEMENTS) return null;
    elements.push(element);
    return elements.length - 1;
  };
  /** The element's anchor against a fresh page snapshot, captured once per session element. */
  const capture = (index: number): { readonly anchor?: FeedbackAnchor; readonly reason?: string } => {
    const known = anchors.get(index);
    if (known) return { anchor: known };
    const element = elements[index];
    if (!element) return { reason: 'the element is gone' };
    const captured = anchorOf(element, policy, { root, page: serializePage(root, policy) });
    if (captured.kind !== 'captured') return { reason: captured.reason };
    const anchor = captured.anchor as unknown as FeedbackAnchor;
    anchors.set(index, anchor);
    return { anchor };
  };

  const ordered = (): NoteRecord[] => [...notes].sort((a, b) => a.t - b.t || a.id - b.id);
  const labelOf = (note: NoteRecord): string => note.label ?? (note.element ? pickerLabel(note.element, policy) : note.target !== undefined && anchors.get(note.target) ? String(anchors.get(note.target)!['fallback']) : 'the page');
  const publish = (change: Partial<FeedbackSessionSnapshot> = {}): void => {
    const list = ordered();
    const views: SessionNote[] = list.map((note, index) => {
      const anchor = note.target !== undefined ? anchors.get(note.target) : undefined;
      const signals = anchor?.['signals'];
      const found = signals !== null && typeof signals === 'object' && !Array.isArray(signals) ? (signals as { readonly source?: unknown }).source : undefined;
      const source = typeof found === 'string' ? found : undefined;
      return Object.freeze({ id: note.id, number: index + 1, text: note.text, label: labelOf(note), ...(anchor ? { fallback: String(anchor['fallback']) } : {}),
        ...(source !== undefined ? { source } : {}), ...(note.from ? { from: note.from } : {}), ...(note.recorded ? { recorded: true as const } : {}) });
    });
    const open = bubble ? list.find(note => note.id === bubble!.noteId) : undefined;
    const { bubble: _bubble, problem: _problem, hover: _hover, ...base } = { ...state.getSnapshot(), ...change };
    const showHover = hoverLabel !== undefined && base.phase === 'active' && !base.using;
    state.replace({
      ...base,
      notes: Object.freeze(views),
      stepCount: timeline.filter(entry => 'step' in entry).length,
      ...(open && bubble && open.element ? { bubble: Object.freeze({ noteId: open.id, number: list.indexOf(open) + 1, element: open.element, label: labelOf(open), text: bubble.text, fresh: bubble.fresh }) } : {}),
      ...(problem !== undefined ? { problem } : {}),
      ...(showHover ? { hover: hoverLabel! } : {}),
    });
    drawPins();
  };

  const drawPins = (): void => {
    if (!pinsOverlay) return;
    if (state.getSnapshot().phase !== 'active') { pinsOverlay.clear(); return; }
    pinsOverlay.draw(ordered().flatMap((note, index) => note.element ? [{ element: note.element, label: pinMark(index + 1), tone: 'pinned' as const }] : []));
  };

  const clip = (text: string): string => [...text].slice(0, FEEDBACK_LIMITS.stepCharacters).join('');
  const record = (step: FeedbackStep): void => {
    if (timeline.length >= FEEDBACK_LIMITS.steps * 2) return;
    const clipped: FeedbackStep = step.kind === 'route' ? { kind: 'route', route: clip(step.route) }
      : step.kind === 'click' ? { kind: 'click', target: clip(step.target) }
        : step.kind === 'key' && step.target !== undefined ? { kind: 'key', key: step.key, target: clip(step.target) } : step;
    timeline.push({ t: now(), step: clipped });
  };
  const checkRoute = (): void => {
    const route = routeNow();
    if (route === lastRoute) return;
    lastRoute = route;
    record({ kind: 'route', route });
    publish({ route });
  };

  // --- the bubble ---------------------------------------------------------------------------------------------------------------
  const closeBubble = (keep: boolean): void => {
    if (!bubble) return;
    const open = bubble;
    bubble = undefined;
    const note = notes.find(item => item.id === open.noteId);
    if (!note) return;
    const text = keep ? open.text : open.before;
    // A pin dropped while recording stays even when empty: its note is what was said there, or what the person types in the review.
    if (!text.trim() && !(note.recorded && !open.fresh)) {
      // An empty note (or a new pin dismissed) is no note: remove it, its pin mark and its place on the timeline.
      notes = notes.filter(item => item !== note);
      timeline = timeline.filter(entry => !('noteId' in entry) || entry.noteId !== note.id);
      pins = pins.filter(mark => !(mark.target === note.target && Math.abs(mark.t - note.t) < 1));
    } else {
      note.text = text;
      if (open.fresh && !timeline.some(entry => 'noteId' in entry && entry.noteId === note.id)) timeline.push({ t: note.t, noteId: note.id });
    }
  };

  const onPick = (element: Element): void => {
    if (state.getSnapshot().phase !== 'active') return;
    problem = undefined;
    closeBubble(true);
    const recording = state.getSnapshot().voice.kind === 'recording';
    const existing = notes.find(note => note.element === element);
    // While recording an existing pin is already numbered; speech near it lands on it. No bubble interrupts the person talking.
    if (existing && recording) { publish(); return; }
    if (existing) {
      bubble = { noteId: existing.id, text: existing.text, fresh: false, before: existing.text };
      publish();
      return;
    }
    const refused = pickRefusal(element, root);
    const target = refused === undefined ? indexOf(element) : null;
    if (target === null) { problem = `This element cannot be pointed at: ${refused ?? 'too many elements in one session'}.`; publish(); return; }
    if (new Set(notes.flatMap(note => note.target !== undefined ? [note.target] : [])).size >= FEEDBACK_LIMITS.anchors) {
      problem = `At most ${FEEDBACK_LIMITS.anchors} pinned elements per feedback.`; publish(); return;
    }
    const captured = capture(target);
    if (!captured.anchor) { problem = `This element cannot be pointed at: ${captured.reason ?? 'unknown reason'}.`; publish(); return; }
    const t = now();
    pins.push({ t, target });
    const note: NoteRecord = { id: nextId++, element, target, label: pickerLabel(element, policy), text: '', t, ...(recording ? { recorded: true as const } : {}) };
    notes.push(note);
    if (recording) timeline.push({ t, noteId: note.id });
    else bubble = { noteId: note.id, text: '', fresh: true, before: '' };
    checkRoute();
    publish();
  };

  const onHover = (element: Element | undefined): void => {
    const target = element ? indexOf(element) : null;
    if (target === lastHover) return;
    lastHover = target;
    if (pointer.length < MAX_TRAIL) pointer.push({ t: now(), target });
    // Hovered elements get anchors too while recording, so speech that lands on them can become a pinned note.
    if (target !== null && state.getSnapshot().voice.kind === 'recording') capture(target);
    hoverLabel = element ? pickerLabel(element, policy) : undefined;
    if (target !== null && hoverLabel !== undefined) labels.set(target, hoverLabel);
    publish();
  };

  // --- using the app (⌥ / the toggle) -------------------------------------------------------------------------------------------
  const applyUsing = (): void => {
    const current = state.getSnapshot();
    const using = current.phase === 'active' && (alt || current.useToggle);
    if (using === current.using) return;
    if (using) { closeBubble(true); lastHover = undefined; hoverLabel = undefined; }
    picker?.suspend(using);
    publish({ using });
  };

  const inApp = (target: EventTarget | null): Element | undefined => {
    const element = target && (target as Node).nodeType === 1 ? target as Element : (target as Node | null)?.parentElement ?? undefined;
    if (!element || isExcluded(element) || pickRefusal(element, root) !== undefined) return undefined;
    return element;
  };
  const later = (run: () => void): void => { if (view) view.setTimeout(run, 0); else run(); };

  const onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.key === 'Alt') { if (!alt) { alt = true; applyUsing(); } return; }
    const current = state.getSnapshot();
    if (current.using) {
      if (NAMED_KEYS.has(key.key)) {
        const element = inApp(event.target);
        record({ kind: 'key', key: key.key, ...(element ? { target: pickerLabel(element, policy) } : {}) });
        later(checkRoute);
        publish();
      }
      return;
    }
    // Esc on the page closes the bubble and never ends feedback mode by accident; in the bubble, the bubble handles it.
    if (key.key === 'Escape' && !event.composedPath().some(item => (item as Element).hasAttribute?.('data-feedback-ignore'))) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (bubble) { closeBubble(false); publish(); }
    }
  };
  const onKeyUp = (event: Event): void => { if ((event as KeyboardEvent).key === 'Alt' && alt) { alt = false; applyUsing(); } };
  const onBlur = (): void => { if (alt) { alt = false; applyUsing(); } };
  const onClick = (event: Event): void => {
    if (!state.getSnapshot().using) return;
    const element = inApp(event.target);
    if (!element) return;
    record({ kind: 'click', target: pickerLabel(element, policy) });
    later(checkRoute);
    publish();
  };
  const onRoute = (): void => { checkRoute(); };

  const listen = (type: string, handler: (event: Event) => void): void => {
    if (!view) return;
    view.addEventListener(type, handler, { capture: true });
    removers.push(() => view.removeEventListener(type, handler, { capture: true }));
  };

  const stopPicking = (): void => {
    for (const remove of removers.splice(0)) remove();
    picker?.dispose();
    picker = undefined;
    pinsOverlay?.dispose();
    pinsOverlay = undefined;
    alt = false;
  };

  let sessionGeneration = 0;
  const reset = (): void => {
    sessionGeneration++;
    elements = []; anchors.clear(); labels.clear(); notes = []; timeline = []; pointer = []; pins = []; recordings = [];
    bubble = undefined; lastHover = undefined; hoverLabel = undefined; observed = undefined; problem = undefined; saved = undefined;
    operation = operationId(); mayHaveSent = false;
  };

  const start = (): void => {
    const current = state.getSnapshot();
    if (current.phase === 'active' || current.phase === 'processing') return;
    stopPicking();
    reset();
    lastRoute = routeNow();
    record({ kind: 'route', route: lastRoute });
    // Keys belong to feedback mode from now on: focus left on the Feedback button (an ignored subtree) would keep them from it.
    const focused = document.activeElement;
    if (focused && focused !== document.body && isExcluded(focused) && typeof (focused as HTMLElement).blur === 'function') (focused as HTMLElement).blur();
    // Listeners first, so they see Alt and Esc before the picker takes them.
    for (const [type, handler] of [['keydown', onKeyDown], ['keyup', onKeyUp], ['click', onClick], ['popstate', onRoute], ['hashchange', onRoute]] as const) listen(type, handler);
    if (view) { view.addEventListener('blur', onBlur); removers.push(() => view.removeEventListener('blur', onBlur)); }
    pinsOverlay = createOverlay({ document, ...(options.styles !== undefined ? { styles: options.styles } : {}) });
    picker = createPicker({
      root, policy, onPick, wheel: false, keys: 'outside-ignored',
      ...(options.styles !== undefined ? { styles: options.styles } : {}),
      ...(options.hitTest ? { hitTest: options.hitTest } : {}),
      onChange: next => { if (next.mode === 'picking' && !next.suspended) onHover(next.current); },
    });
    void picker.start();
    state.set({ phase: 'active', using: false, useToggle: false, general: '', voice: { kind: 'off' }, transcribing: false, send: { kind: 'idle' }, copy: { kind: 'idle' }, route: lastRoute });
    publish();
  };

  // --- voice --------------------------------------------------------------------------------------------------------------------
  // Stop shows "stopping" at once, but the capture hands the audio over later (the recorder's last chunk, decoding its duration): Done
  // pressed meanwhile must wait for it, or the recording would be silently lost. One stop at a time; a discard in between drops it.
  let stopping: Promise<void> | undefined;
  const stopRecording = (): Promise<void> => {
    if (stopping) return stopping;
    if (!options.voice || state.getSnapshot().voice.kind !== 'recording') return Promise.resolve();
    const voice = options.voice;
    const generation = sessionGeneration;
    state.set({ voice: { kind: 'stopping' } });
    stopping = (async () => {
      let recording: VoiceRecording | null = null, failed = false;
      try { recording = await voice.stop(); } catch { failed = true; }
      if (generation !== sessionGeneration) return;
      if (recording) recordings.push(recording);
      else problem = failed ? 'The recording could not be finished. Your pins are kept.' : 'Nothing was recorded: the microphone gave no sound. Your pins are kept.';
      if (state.getSnapshot().voice.kind === 'stopping') state.set({ voice: { kind: 'off' } });
      publish();
    })().finally(() => { stopping = undefined; });
    return stopping;
  };
  const toggleVoice = async (): Promise<void> => {
    const current = state.getSnapshot();
    if (!options.voice || !voiceAvailable || current.phase !== 'active') return;
    if (current.voice.kind === 'recording') { await stopRecording(); publish(); return; }
    if (current.voice.kind === 'starting' || current.voice.kind === 'stopping') return;
    // Called straight from the click: nothing is awaited before the capture asks for the microphone, so the permission prompt keeps
    // the person's gesture. The bubble closes (its text kept): while recording, pins take no bubble.
    let starting: ReturnType<VoiceCapture['start']>;
    try { starting = options.voice.start(); } catch (error) { starting = Promise.reject(error); }
    closeBubble(true);
    problem = undefined;
    state.set({ voice: { kind: 'starting' } });
    publish();
    let started: Awaited<ReturnType<VoiceCapture['start']>>;
    try { started = await starting; } catch { started = { kind: 'refused', code: 'failed', reason: 'The microphone could not be started.' }; }
    if (state.getSnapshot().phase !== 'active') { if (started.kind === 'recording') options.voice.cancel(); return; }
    state.set({ voice: started.kind === 'recording' ? { kind: 'recording' } : { kind: 'refused', reason: started.reason, ...(started.code ? { code: started.code } : {}) } });
    // The element under the pointer when recording starts is the first sample of the trail.
    if (started.kind === 'recording' && lastHover !== undefined && lastHover !== null) { pointer.push({ t: now(), target: lastHover }); capture(lastHover); }
    publish();
  };

  /** Speech merged into the notes: on a pinned element it extends that note; on a hovered element it becomes a pin note marked voice;
   * anywhere else it becomes part of the general note. A transcription with text but no timed segments cannot be placed in time,
   * so all of it goes to the general note (pins made while recording stay as empty notes to type into). Throws when nothing usable
   * came back. */
  const merge = async (recording: VoiceRecording): Promise<void> => {
    const answer = readTranscription(await options.transcribe!(recording.audio, recording.mimeType));
    if (!answer) throw new TypeError(''); // nothing usable: the plain "could not be transcribed" message
    const general: string[] = [];
    const aligned = 'segments' in answer ? alignSpeech({ segments: answer.segments, audioStartedAt: recording.startedAt, pointer, pins }) : [];
    if ('text' in answer && answer.text.trim()) general.push(answer.text.trim());
    for (const piece of aligned) {
      const text = piece.text.trim();
      if (!text) continue;
      const pinned = piece.target === null ? undefined : notes.find(note => note.target === piece.target && note.element !== undefined && note.from === undefined);
      if (pinned) {
        // A pin dropped while recording with nothing typed: its note is what was said, so it is a voice note.
        if (pinned.recorded && !pinned.text.trim()) pinned.from = 'voice';
        pinned.text = pinned.text.trim() ? `${pinned.text}\n${text}` : text;
        continue;
      }
      const anchor = piece.target === null ? undefined : anchors.get(piece.target) ?? capture(piece.target).anchor;
      const pinnedCount = new Set(notes.flatMap(note => note.target !== undefined ? [note.target] : [])).size;
      if (piece.target !== null && anchor && (notes.some(note => note.target === piece.target) || pinnedCount < FEEDBACK_LIMITS.anchors)) {
        const voiced = notes.find(note => note.target === piece.target && note.from === 'voice');
        if (voiced) { voiced.text = `${voiced.text}\n${text}`; continue; }
        const element = elements[piece.target];
        const note: NoteRecord = { id: nextId++, target: piece.target, text, t: piece.at, from: 'voice', ...(element ? { element, label: labels.get(piece.target) ?? pickerLabel(element, policy) } : {}) };
        notes.push(note);
        timeline.push({ t: piece.at, noteId: note.id });
        continue;
      }
      general.push(text);
    }
    if (general.length) {
      const current = state.getSnapshot().general;
      state.set({ general: [current.trim(), general.join(' ')].filter(Boolean).join('\n') });
    }
  };

  const done = async (): Promise<void> => {
    if (state.getSnapshot().phase !== 'active') return;
    closeBubble(true);
    checkRoute();
    await stopRecording();
    stopPicking();
    const transcribing = recordings.length > 0 && options.transcribe !== undefined;
    state.set({ phase: 'processing', using: false, useToggle: false, transcribing });
    publish();
    if (transcribing) {
      for (const recording of recordings) {
        try { await merge(recording); }
        catch (error) {
          const pinned = notes.some(note => note.recorded);
          problem = `Voice could not be transcribed${error instanceof Error && error.message ? ` (${error.message})` : ''}. ${pinned ? 'Your pins are kept: type a note for each in the review.' : 'Your typed notes are kept.'}`;
        }
      }
    }
    recordings = [];
    state.set({ transcribing: false });
    try { observed = (await observePage(options)).observed; }
    catch { problem = 'The page could not be observed.'; }
    state.set({ phase: notes.length || state.getSnapshot().general.trim() ? 'review' : 'idle', route: observed?.subject.route ?? routeNow() });
    publish();
  };

  const discard = (): void => {
    if (options.voice && state.getSnapshot().voice.kind === 'recording') options.voice.cancel();
    stopPicking();
    reset();
    state.set({ phase: 'idle', using: false, useToggle: false, general: '', voice: { kind: 'off' }, transcribing: false, send: { kind: 'idle' }, copy: { kind: 'idle' } });
    publish();
  };

  // --- the draft ----------------------------------------------------------------------------------------------------------------
  const edited = (): void => {
    // A changed draft may take a fresh operation id unless the current one may already have reached the store.
    if (!mayHaveSent && state.getSnapshot().send.kind !== 'saved') operation = operationId();
    state.set({ copy: { kind: 'idle' }, ...(state.getSnapshot().send.kind !== 'saved' ? { send: { kind: 'idle' } as SendState } : {}) });
  };

  const draft = (): FeedbackDraft => {
    if (!observed) throw new TypeError('Press Done first: there is no feedback draft yet.');
    const list = ordered().filter(note => note.text.trim());
    const targets: number[] = [];
    const draftNotes: FeedbackNote[] = list.map(note => {
      const anchored = note.target !== undefined && anchors.has(note.target);
      if (anchored && !targets.includes(note.target!)) targets.push(note.target!);
      return { text: note.text, ...(anchored ? { anchor: targets.indexOf(note.target!) } : {}), ...(note.from ? { from: note.from } : {}) };
    });
    const noteIndex = new Map(list.map((note, index) => [note.id, index]));
    const steps: FeedbackStep[] = [...timeline].sort((a, b) => a.t - b.t).flatMap((entry): FeedbackStep[] => {
      if ('step' in entry) return [entry.step];
      const index = noteIndex.get(entry.noteId);
      return index === undefined ? [] : [{ kind: 'note', note: index }];
    }).slice(0, FEEDBACK_LIMITS.steps);
    const general = state.getSnapshot().general;
    if (!draftNotes.length && !general.trim()) throw new TypeError('There is nothing to send: every note is empty.');
    return {
      observed, anchors: targets.map(target => anchors.get(target)!), said: general,
      ...(draftNotes.length ? { notes: draftNotes } : {}),
      ...(steps.some(step => step.kind !== 'route') || steps.length > 1 ? { steps } : {}),
    };
  };
  const reportText = (): string => feedbackText(draftReport(draft(), { id: draftId(), created: new Date().toISOString() }));
  const copy = async (): Promise<CopyState> => {
    let text: string;
    try { text = reportText(); }
    catch (error) { state.set({ copy: { kind: 'refused', reason: error instanceof Error ? error.message : 'The report could not be rendered.' } }); publish(); return state.getSnapshot().copy; }
    let copied = false;
    try { copied = await (options.copyText ?? copyToClipboard)(text); } catch { copied = false; }
    state.set({ copy: copied ? { kind: 'copied', text } : { kind: 'manual', text } });
    publish();
    return state.getSnapshot().copy;
  };

  const attach = async (): Promise<FeedbackAttachment> => {
    if (state.getSnapshot().phase !== 'review') return { kind: 'refused', reason: 'There is no feedback to send.' };
    let current: FeedbackDraft;
    try { current = draft(); } catch (error) { return { kind: 'refused', reason: error instanceof Error ? error.message : 'There is nothing to send.' }; }
    if (!options.save) {
      try { return { kind: 'inline', text: reportText() }; }
      catch (error) { return { kind: 'refused', reason: error instanceof Error ? error.message : 'The report could not be rendered.' }; }
    }
    if (saved) return options.mention ? { kind: 'mention', id: saved.id, path: options.mention(saved.id) } : { kind: 'inline', text: reportText() };
    if (state.getSnapshot().send.kind === 'sending') return { kind: 'refused', reason: 'Already sending.' };
    state.set({ send: { kind: 'sending' } });
    mayHaveSent = true;
    let result: SaveResult;
    try { result = await options.save({ operationId: operation, draft: current }); }
    catch { result = { kind: 'unknown', reason: 'The save did not answer; Send again to reconcile it.' }; }
    if (result.kind === 'denied' || result.kind === 'unavailable' || result.kind === 'invalid') mayHaveSent = false;
    state.set({ send: result });
    if (result.kind !== 'saved') return { kind: 'refused', reason: result.kind === 'unknown' ? `${result.reason} Nothing is lost: Send again uses the same operation, so it cannot be stored twice.` : `Not saved: ${result.reason}` };
    saved = { id: result.id };
    return options.mention ? { kind: 'mention', id: result.id, path: options.mention(result.id) } : { kind: 'inline', text: reportText() };
  };

  const highlight = (id: number | undefined): 'shown' | 'not-on-page' | 'none' => {
    pinsOverlay ??= createOverlay({ document, ...(options.styles !== undefined ? { styles: options.styles } : {}) });
    if (id === undefined) { pinsOverlay.clear(); return 'none'; }
    const list = ordered();
    const note = list.find(item => item.id === id);
    if (!note || !note.element) { pinsOverlay.clear(); return note ? 'not-on-page' : 'none'; }
    if (!note.element.isConnected || !root.contains(note.element)) { pinsOverlay.clear(); return 'not-on-page'; }
    pinsOverlay.highlight(note.element, `${pinMark(list.indexOf(note) + 1)} ${note.text.split('\n')[0] ?? ''}`.trim());
    return 'shown';
  };

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    start,
    done,
    discard,
    setBubbleText: text => { if (bubble) { bubble.text = text; publish(); } },
    saveBubble: () => { closeBubble(true); publish(); },
    cancelBubble: () => { closeBubble(false); publish(); },
    setUseToggle: on => { state.set({ useToggle: on }); applyUsing(); publish(); },
    toggleVoice,
    setNoteText: (id, text) => { const note = notes.find(item => item.id === id); if (note && note.text !== text) { note.text = text; edited(); publish(); } },
    removeNote: id => {
      notes = notes.filter(item => item.id !== id);
      timeline = timeline.filter(entry => !('noteId' in entry) || entry.noteId !== id);
      edited();
      if (state.getSnapshot().phase === 'review' && !notes.length && !state.getSnapshot().general.trim()) { discard(); return; }
      publish();
    },
    setGeneral: text => { if (text !== state.getSnapshot().general) { state.set({ general: text }); edited(); publish(); } },
    highlight,
    draft,
    reportText,
    copy,
    attach,
    sent: () => { pinsOverlay?.clear(); discard(); },
    trail: () => ({ pointer: Object.freeze([...pointer]), pins: Object.freeze([...pins]) }),
    dispose: () => { discard(); pinsOverlay?.dispose(); pinsOverlay = undefined; },
  };
}
