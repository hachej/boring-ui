// The feedback session's look (FEEDBACK.md, "UX"): the slim bar of feedback mode, the note bubble beside a pin, and the one chip the
// composer shows afterwards with its review. Everything they show and do is the headless `createFeedbackSession` from
// `@hachej/boring-feedback/ui` (hover labels, pins, steps, voice, the draft and Send come from there, through the privacy policy); this file is
// how it looks. `useComposerFeedback` adapts a session to the chat composer's optional `feedback` prop (registry/pi-chat), structurally,
// so neither item imports the other.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { readableElement } from '@hachej/boring-feedback/format';
import { pinMark, type FeedbackSession, type FeedbackSessionSnapshot, type SessionNote } from '@hachej/boring-feedback/ui';
import { useExternal } from './use-external';
import { withLabels, type FeedbackLabels } from './feedback-labels';

/** A microphone outline drawn inline: emoji glyphs (🎙) are missing from some system fonts. */
const MicIcon = () => <svg className="boring-feedback-mic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  <rect x="9" y="2" width="6" height="13" rx="3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" />
</svg>;

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
/** Notes the chip and the bar count: every note that says something (not a pin still being typed), plus the general note. */
export function noteCount(state: FeedbackSessionSnapshot): number {
  return state.notes.filter(note => note.text.trim()).length + (state.general.trim() ? 1 : 0);
}

export interface FeedbackBarProps {
  readonly session: FeedbackSession;
  readonly className?: string;
  /** Docked under the chat composer (the composer's `feedback.bar`) instead of floating at the top of the page. */
  readonly docked?: boolean;
  /** Words of the controls (`feedbackLabelsFr` for French); what is left out keeps the English default. */
  readonly labels?: Partial<FeedbackLabels>;
}

/** Pins dropped while recording that have no note yet (nothing transcribed for them, or transcription failed). */
export function emptyPinCount(state: FeedbackSessionSnapshot): number {
  return state.notes.filter(note => note.recorded && !note.text.trim()).length;
}

/** `mm:ss` since `since` (ms), for the recording timer. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The running time of a recording, from when the bar saw it start; 00:00 when not recording. */
function useRecordingTime(recording: boolean): string {
  const [since, setSince] = useState<number | undefined>(undefined);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!recording) { setSince(undefined); return; }
    setSince(Date.now());
    const timer = setInterval(() => tick(value => value + 1), 500);
    return () => clearInterval(timer);
  }, [recording]);
  return elapsed(since === undefined ? 0 : Date.now() - since);
}

function barHint(state: FeedbackSessionSnapshot): string {
  if (state.phase === 'processing') return state.transcribing ? 'Transcribing…' : 'Preparing your feedback…';
  if (state.problem) return state.problem;
  if (state.voice.kind === 'starting') return 'Allow the microphone if your browser asks…';
  if (state.voice.kind === 'recording') return state.using ? 'Recording — using the app' : 'Recording — point and talk';
  return state.using ? 'Using the app: your clicks are recorded as steps' : 'Click what you want to comment on';
}

/**
 * Feedback mode's bar: `● Feedback · N notes · 🎙 Record · Hold ⌥ to use the app · Use app · Done · ✕`. While recording: a red dot, the
 * running time, "Recording — point and talk" and Stop. A refused microphone is said in the bar itself, never only in a tooltip.
 */
export function FeedbackBar({ session, className, docked = false, labels }: FeedbackBarProps) {
  const state = useExternal(session);
  const words = withLabels(labels);
  const recording = state.voice.kind === 'recording';
  const time = useRecordingTime(recording && (state.phase === 'active' || state.phase === 'processing'));
  if (state.phase !== 'active' && state.phase !== 'processing') return null;
  const processing = state.phase === 'processing';
  const pins = emptyPinCount(state);
  const voiceProblem = state.voice.kind === 'refused' ? state.voice : undefined;
  return <div data-boring="feedback" data-feedback-ignore="" role="toolbar" aria-label="Feedback mode" data-testid="feedback-bar" data-docked={docked ? 'true' : 'false'}
    data-using={state.using ? 'true' : 'false'} data-recording={recording ? 'true' : 'false'} data-transcribing={state.transcribing ? 'true' : 'false'}
    className={['boring-feedback-bar', className].filter(Boolean).join(' ')}
    onKeyDown={event => { if (event.key === 'Escape' && (state.bubble || state.generalOpen)) { event.stopPropagation(); if (state.bubble) session.cancelBubble(); else session.closeGeneral(); } }}>
    <span className="boring-feedback-bar-title"><span className="boring-feedback-dot" aria-hidden="true" />Feedback</span>
    <span className="boring-feedback-bar-meta" data-testid="feedback-bar-count">{plural(noteCount(state), 'note', 'notes')}{pins ? ` · ${plural(pins, 'pin', 'pins')}` : ''}</span>
    {state.voiceAvailable && <button type="button" className="boring-feedback-button boring-feedback-record" data-testid="feedback-voice" aria-pressed={recording}
      disabled={processing || state.voice.kind === 'starting' || state.voice.kind === 'stopping'} title={recording ? 'Stop recording' : 'Record your voice while you point: each click drops a pin, what you say becomes its note'}
      onClick={() => { void session.toggleVoice(); }}>
      {recording ? <><span className="boring-feedback-stop" aria-hidden="true" />Stop</> : <><MicIcon />{state.voice.kind === 'starting' ? 'Starting…' : state.voice.kind === 'stopping' ? 'Stopping…' : 'Record'}</>}
    </button>}
    {recording && <span className="boring-feedback-recording" role="status" data-testid="feedback-recording"><span className="boring-feedback-rec" aria-hidden="true" />
      <span className="boring-feedback-timer" data-testid="feedback-recording-time">{time}</span></span>}
    <span className="boring-feedback-hint" role="status" aria-live="polite" data-testid="feedback-bar-hint">{barHint(state)}</span>
    {voiceProblem && <span className="boring-feedback-voice-problem" role="alert" data-testid="feedback-voice-problem" data-code={voiceProblem.code}>{voiceProblem.reason}</span>}
    {!processing && <button type="button" className="boring-feedback-button" data-testid="feedback-general" aria-pressed={state.generalOpen} onClick={() => session.askGeneral()}>{words.askGeneral}</button>}
    {!processing && <span className="boring-feedback-keys boring-feedback-alt">Hold ⌥ to use the app</span>}
    {!processing && <button type="button" className="boring-feedback-button" data-testid="feedback-use-app" aria-pressed={state.useToggle} onClick={() => session.setUseToggle(!state.useToggle)}>Use app</button>}
    <button type="button" className="boring-feedback-button" data-variant="primary" data-testid="feedback-done" disabled={processing} onClick={() => { void session.done(); }}>Done</button>
    <button type="button" className="boring-feedback-icon" data-testid="feedback-discard" aria-label="Discard feedback" title="Discard feedback" disabled={processing} onClick={() => session.discard()}>×</button>
  </div>;
}

const BUBBLE_WIDTH = 280;
/** Pixels at the bottom of the viewport taken by point mode's bar (PointBar, `data-feedback-point-bar`), plus a gap; 0 without it. */
export function pointBarInset(document: Document): number {
  const bar = document.querySelector('[data-feedback-point-bar]');
  const height = document.defaultView?.innerHeight ?? 768;
  return bar ? Math.max(0, height - bar.getBoundingClientRect().top + 8) : 0;
}

/**
 * Beside the element: below it when the bubble (`size`, its measured height once drawn) fits above point mode's bar (if any), else
 * above it, else as low as it fits. Every branch is clamped to the space above the bar, so the bubble never covers it; a bubble taller
 * than that space scrolls inside it.
 */
function bubblePlace(element: Element, size = 120): CSSProperties {
  const view = element.ownerDocument.defaultView;
  const width = view?.innerWidth ?? 1024, height = (view?.innerHeight ?? 768) - pointBarInset(element.ownerDocument);
  const rect = element.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.left), Math.max(8, width - BUBBLE_WIDTH - 8));
  const below = rect.bottom + 8;
  const above = rect.top - size - 8;
  const lowest = Math.max(8, height - size);
  const top = Math.min(below + size <= height ? below : above >= 8 ? above : lowest, lowest);
  return { position: 'fixed', top, left, width: Math.min(BUBBLE_WIDTH, width - 16), maxHeight: Math.max(0, height - top), overflowY: 'auto' };
}

/** After a bubble closes with focus nowhere (the focused field left the page), focus goes back to the bar's general-question entry. */
function useFocusReturn(open: boolean, document: Document | undefined): void {
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open && document) {
      const active = document.activeElement;
      if (!active || active === document.body) document.querySelector<HTMLElement>('[data-testid="feedback-general"]')?.focus({ preventScroll: true });
    }
    was.current = open;
  }, [open, document]);
}

/**
 * The note bubble beside a new or reopened pin: "What's wrong here?", Enter saves, Shift-Enter for a new line, Esc discards the pin,
 * and "Cancel selection" (also clicking the pinned element again) drops the pin and keeps what was typed for a general question.
 * With the general question open it is a bubble with no element: the same field, docked at the bottom, Esc closes it. In point mode
 * it keeps clear of the PointBar. One NoteBubble serves both modes.
 */
export function NoteBubble({ session, labels }: { readonly session: FeedbackSession; readonly labels?: Partial<FeedbackLabels> }) {
  const state = useExternal(session);
  const words = withLabels(labels);
  const bubble = state.bubble;
  const field = useRef<HTMLTextAreaElement>(null);
  const general = useRef<HTMLTextAreaElement>(null);
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  const [, redraw] = useState(0);
  const [announce, setAnnounce] = useState('');
  const generalOpen = state.generalOpen && state.phase === 'active';
  const box = useRef<HTMLDivElement>(null);
  // The bubble's natural height (its content plus borders), not the height it is clamped to, so it grows back when there is room.
  const size = (): number | undefined => (box.current ? box.current.scrollHeight + box.current.offsetHeight - box.current.clientHeight : 0) || undefined;
  useLayoutEffect(() => { if (bubble) setPlace(bubblePlace(bubble.element, size())); }, [bubble?.noteId, bubble?.element]);
  // Once drawn, place it again with its real height (taller with 44px touch targets and wrapped buttons).
  useLayoutEffect(() => {
    if (!bubble || !place || !box.current) return;
    const next = bubblePlace(bubble.element, size());
    if (next.top !== place.top || next.left !== place.left) setPlace(next);
  });
  useEffect(() => { if (bubble) field.current?.focus({ preventScroll: true }); }, [bubble?.noteId]);
  useEffect(() => { if (generalOpen) { general.current?.focus({ preventScroll: true }); setAnnounce(words.generalOpened); } }, [generalOpen]);
  useEffect(() => {
    if (!bubble) return;
    const view = bubble.element.ownerDocument.defaultView;
    const follow = () => { setPlace(bubblePlace(bubble.element, size())); redraw(value => value + 1); };
    view?.addEventListener('scroll', follow, { capture: true, passive: true });
    view?.addEventListener('resize', follow);
    return () => { view?.removeEventListener('scroll', follow, { capture: true }); view?.removeEventListener('resize', follow); };
  }, [bubble?.noteId, bubble?.element]);
  useFocusReturn(Boolean(bubble) || generalOpen, typeof document === 'undefined' ? undefined : document);
  // A polite live region outlives the bubble, so the cancellation is heard even though the dialog is gone.
  const cancel = (): void => { session.cancelSelection(); setAnnounce(words.selectionCancelled); };
  const live = <span data-boring="feedback" data-feedback-ignore="" role="status" aria-live="polite" className="boring-feedback-sr" data-testid="feedback-bubble-announce"
    style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{announce}</span>;
  if (generalOpen && !bubble) {
    const onGeneralKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)) { event.preventDefault(); event.stopPropagation(); session.closeGeneral(); }
    };
    return <>{live}<div data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label={words.askGeneral} data-testid="feedback-general-bubble"
      className="boring-feedback-bubble" style={{ position: 'fixed', left: 8, right: 8, bottom: Math.max(72, typeof document === 'undefined' ? 0 : pointBarInset(document)), margin: '0 auto', maxWidth: 420 }}>
      <span className="boring-feedback-bubble-head"><span className="boring-feedback-bubble-label">{words.askGeneral}</span></span>
      <textarea ref={general} data-testid="feedback-general-input" rows={3} placeholder={words.generalPlaceholder} aria-label={words.generalField} value={state.general}
        onChange={event => session.setGeneral(event.target.value)} onKeyDown={onGeneralKey} />
      <span className="boring-feedback-keys">{words.generalHint}</span>
    </div></>;
  }
  if (!bubble || state.phase !== 'active') return state.phase === 'active' ? live : null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.target === field.current) { event.preventDefault(); session.saveBubble(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); session.cancelBubble(); }
  };
  return <>{live}<div data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label={`Note ${bubble.number}`} data-testid="feedback-bubble" data-note={bubble.number}
    ref={box} className="boring-feedback-bubble" style={place} onKeyDown={onKeyDown}>
    <span className="boring-feedback-bubble-head"><span className="boring-feedback-pin" aria-hidden="true">{pinMark(bubble.number)}</span>
      <span className="boring-feedback-bubble-label" data-testid="feedback-bubble-label">{bubble.label}</span></span>
    <textarea ref={field} data-testid="feedback-bubble-input" rows={2} placeholder={words.bubblePlaceholder} aria-label={words.bubblePlaceholder} value={bubble.text}
      onChange={event => session.setBubbleText(event.target.value)} />
    <span className="boring-feedback-bubble-actions">
      <button type="button" className="boring-feedback-button" data-testid="feedback-cancel-selection" onClick={cancel}>{words.cancelSelection}</button>
      <button type="button" className="boring-feedback-button" data-testid="feedback-bubble-general" onClick={() => session.askGeneral()}>{words.askGeneral}</button>
    </span>
    <span className="boring-feedback-keys">{words.bubbleHint}</span>
  </div></>;
}

export interface FeedbackChipProps {
  readonly session: FeedbackSession;
  /** Opens the review on first render (journeys). */
  readonly defaultOpen?: boolean;
  /** Offer Copy report in the review: the way to use feedback with no chat and no store. */
  readonly copy?: boolean;
}

/** The one composer chip after Done: `💬 Feedback · 3 notes · /settings/:section`. Click opens the review; × discards. */
export function FeedbackChip({ session, defaultOpen = false, copy = false }: FeedbackChipProps) {
  const state = useExternal(session);
  const [open, setOpen] = useState(defaultOpen);
  const chip = useRef<HTMLSpanElement>(null);
  if (state.phase !== 'review') return null;
  const count = noteCount(state);
  const pins = emptyPinCount(state);
  const refusal = state.send.kind !== 'idle' && state.send.kind !== 'sending' && state.send.kind !== 'saved' ? state.send.reason : undefined;
  return <span ref={chip} data-boring="feedback" data-feedback-ignore="" data-testid="feedback-chip" data-send={state.send.kind} className="boring-feedback-chip">
    <button type="button" className="boring-feedback-chip-open" data-testid="feedback-chip-open" aria-expanded={open} onClick={() => setOpen(value => !value)}
      title={refusal ?? 'Review your feedback before sending'}>
      <span aria-hidden="true">💬</span> Feedback · {plural(count, 'note', 'notes')}{pins ? ` · ${plural(pins, 'pin', 'pins')} to describe` : ''} · <span className="boring-feedback-chip-route">{state.route}</span>
    </button>
    <button type="button" className="boring-feedback-icon boring-feedback-chip-remove" data-testid="feedback-chip-discard" aria-label="Discard feedback" onClick={() => { session.highlight(undefined); session.discard(); }}>×</button>
    {state.problem && <span className="boring-feedback-warning" role="alert" data-testid="feedback-chip-voice">{state.problem}</span>}
    {refusal && <span className="boring-feedback-warning" role="alert" data-testid="feedback-chip-problem">{refusal}</span>}
    {/* In the page's body: the chip may sit in a transformed chat bar, where a fixed panel would not be placed against the viewport. */}
    {open && createPortal(<FeedbackReview session={session} anchor={chip.current} copy={copy} onClose={() => setOpen(false)} />, chip.current?.ownerDocument.body ?? document.body)}
  </span>;
}

function reviewPlace(anchor: Element | null): CSSProperties | undefined {
  if (!anchor) return undefined;
  const view = anchor.ownerDocument.defaultView;
  const width = view?.innerWidth ?? 1024, height = view?.innerHeight ?? 768;
  const rect = anchor.getBoundingClientRect();
  const panel = Math.min(416, width - 24);
  return { position: 'fixed', left: Math.min(Math.max(12, rect.left), width - panel - 12), bottom: Math.max(12, height - rect.top + 8), width: panel };
}

/** The compact review: notes in order, editable and removable; hovering a note highlights its element in the page, or says it is not here. */
export function FeedbackReview({ session, anchor = null, copy = false, onClose }: { readonly session: FeedbackSession; readonly anchor?: Element | null; readonly copy?: boolean; readonly onClose: () => void }) {
  const state = useExternal(session);
  const [where, setWhere] = useState<Readonly<Record<number, 'shown' | 'not-on-page'>>>({});
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => { setPlace(reviewPlace(anchor)); }, [anchor]);
  useEffect(() => () => { session.highlight(undefined); }, [session]);
  const hover = (id: number | undefined): void => {
    const result = session.highlight(id);
    if (id !== undefined && result !== 'none') setWhere(value => ({ ...value, [id]: result }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
  return <section data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label="Review feedback" data-testid="feedback-review" className="boring-feedback-review"
    style={place} onKeyDown={onKeyDown} onMouseLeave={() => hover(undefined)}>
    <header className="boring-feedback-sheet-header"><h2>Feedback · {state.route}</h2>
      <button type="button" className="boring-feedback-icon" aria-label="Close review" data-testid="feedback-review-close" onClick={onClose}>×</button></header>
    {state.problem && <p className="boring-feedback-warning" role="alert" data-testid="feedback-review-problem">{state.problem}</p>}
    <ol className="boring-feedback-notes">
      {state.notes.map(note => <li key={note.id} data-testid="feedback-review-note" data-note={note.number} data-where={where[note.id]}
        onMouseEnter={() => hover(note.id)} onFocus={() => hover(note.id)}>
        <span className="boring-feedback-note-head"><span className="boring-feedback-pin" aria-hidden="true">{pinMark(note.number)}</span>
          <ElementName note={note} />
          {note.from === 'voice' && <span className="boring-feedback-badge" data-testid="feedback-review-voice">voice</span>}
          {where[note.id] === 'not-on-page' && <span className="boring-feedback-badge" data-testid="feedback-review-elsewhere">not on this page</span>}
          <button type="button" className="boring-feedback-icon" aria-label={`Remove note ${note.number}`} data-testid="feedback-review-remove" onClick={() => session.removeNote(note.id)}>×</button></span>
        <textarea rows={2} aria-label={`Note ${note.number}`} data-testid="feedback-review-text" value={note.text} placeholder={note.recorded ? 'Nothing was said here: type a note, or remove the pin' : undefined}
          onChange={event => session.setNoteText(note.id, event.target.value)} />
      </li>)}
    </ol>
    <label className="boring-feedback-field"><span>General note</span>
      <textarea rows={2} data-testid="feedback-review-general" placeholder="Anything else? (optional)" value={state.general} onChange={event => session.setGeneral(event.target.value)} /></label>
    <p className="boring-feedback-meta">{state.stepCount > 1 ? `${plural(state.stepCount, 'step', 'steps')} recorded between the notes. ` : ''}{copy ? 'Copy the report and paste it anywhere.' : 'Sent with your next message.'}</p>
    {copy && <div className="boring-feedback-actions">
      <button type="button" className="boring-feedback-button" data-variant="primary" data-testid="feedback-copy" onClick={() => { void session.copy(); }}>Copy report</button></div>}
    {copy && <p role="status" aria-live="polite" className="boring-feedback-status" data-testid="feedback-status" data-copy={state.copy.kind}>
      {state.copy.kind === 'copied' ? 'Report copied. Paste it anywhere.' : state.copy.kind === 'manual' ? 'The clipboard is not available here: select the report below and copy it.' : state.copy.kind === 'refused' ? state.copy.reason : ''}</p>}
    {copy && state.copy.kind === 'manual' && <textarea readOnly className="boring-feedback-manual" data-testid="feedback-manual-copy" value={state.copy.text} rows={6} onFocus={event => event.currentTarget.select()} />}
    {copy && state.copy.kind === 'copied' && <details className="boring-feedback-copied"><summary>Copied report</summary><pre data-testid="feedback-copy-text">{state.copy.text}</pre></details>}
  </section>;
}

/**
 * A note's element as one calm line: the readable name (semibold) and the file basename (muted, monospace), the full path in the
 * tooltip. The same reading as the pi-chat feedback card's element line (`readableElement` from `@hachej/boring-feedback/format`).
 */
export function ElementName({ note }: { readonly note: SessionNote }) {
  const readable = note.fallback ? readableElement(note.fallback, note.source) : { name: note.label };
  return <span className="boring-feedback-element" data-testid="feedback-review-element" title={'path' in readable && readable.path ? readable.path : note.label}>
    <span className="boring-feedback-element-name" data-testid="feedback-review-name">{readable.name}</span>
    {'file' in readable && readable.file && <span className="boring-feedback-element-file" data-testid="feedback-review-file">{readable.file}</span>}
  </span>;
}

/** What `useComposerFeedback` returns: the structural shape of pi-chat's `ComposerFeedback`. */
export interface ComposerFeedbackProp {
  readonly start?: () => void;
  readonly point?: () => void;
  readonly active: boolean;
  readonly pending: boolean;
  readonly chip?: ReactNode;
  readonly attach: (text: string) => Promise<{ readonly kind: 'ok'; readonly text: string } | { readonly kind: 'refused'; readonly reason: string }>;
  readonly sent: () => void;
}

/** A Markdown fence longer than any backtick run in the text. */
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}markdown\n${text.endsWith('\n') ? text : `${text}\n`}${fence}`;
}

export interface ComposerFeedbackOptions {
  /**
   * Which entry points the composer offers: `feedback` (default) the Feedback button and feedback mode docked in the composer; `point`
   * the « Show in app » action for phones (point mode: the host hides its panel while `usePointing` is true and mounts `PointMode`);
   * `both` offers the two.
   */
  readonly entry?: 'feedback' | 'point' | 'both';
}

/**
 * The composer's `feedback` prop for a session: the Feedback button (or « Show in app ») starts it, the chip shows the draft, and Send
 * attaches the report: a saved report as its `@` mention (the host's mention resolver inlines the stored report with the person's
 * access), otherwise the rendered report inline in a fenced block.
 */
export function useComposerFeedback(session: FeedbackSession | undefined, { entry = 'feedback' }: ComposerFeedbackOptions = {}): ComposerFeedbackProp | undefined {
  const state = useSyncState(session);
  if (!session || !state) return undefined;
  const on = state.phase === 'active' || state.phase === 'processing';
  return {
    ...(entry !== 'point' ? { start: () => session.start() } : {}),
    ...(entry !== 'feedback' ? { point: () => session.start({ mode: 'point' }) } : {}),
    active: on,
    pending: state.phase === 'review',
    // Point mode's bar is PointMode, mounted by the host outside its (hidden) panel.
    ...(on && state.mode === 'feedback' ? { bar: <FeedbackBar session={session} docked /> } : {}),
    ...(state.phase === 'review' ? { chip: <FeedbackChip session={session} /> } : {}),
    attach: async text => {
      const attached = await session.attach();
      if (attached.kind === 'refused') return attached;
      const body = attached.kind === 'mention' ? `@${attached.path}` : fenced(attached.text);
      return { kind: 'ok', text: text.trim() ? `${text.trimEnd()}\n\n${body}` : body };
    },
    sent: () => session.sent(),
  };
}

const NO_STATE = { getSnapshot: () => undefined, subscribe: () => () => {} };
function useSyncState(session: FeedbackSession | undefined): FeedbackSessionSnapshot | undefined {
  return useExternal<FeedbackSessionSnapshot | undefined>(session ?? NO_STATE);
}
