// The feedback session's look (FEEDBACK.md, "UX"): the note pin beside a picked element (NoteBubble: a text field with a mic inside it),
// the slim bar and the chip with its review (optional, for hosts with no chat). Everything they show and do is the headless
// `createFeedbackSession` from `@hachej/boring-feedback/ui` (hover labels, pins, steps, the draft and Send come from there, through the
// privacy policy); this file is how it looks. `useComposerFeedback` adapts a session to the chat composer's optional `feedback` prop
// (registry/pi-chat): ONE annotate toggle and a count chip, structurally, so neither item imports the other.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MicIcon, SquareIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { readableElement } from '@hachej/boring-feedback/format';
import { createVoiceCapture, type VoiceCapture } from '@hachej/boring-feedback/page';
import { pinMark, type FeedbackSession, type FeedbackSessionSnapshot, type SessionNote } from '@hachej/boring-feedback/ui';
import { useExternal } from './use-external';
import { withLabels, type FeedbackLabels } from './feedback-labels';

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
export function FeedbackBar({ session, className, docked = false }: FeedbackBarProps) {
  const state = useExternal(session);
  const recording = state.voice.kind === 'recording';
  const time = useRecordingTime(recording && (state.phase === 'active' || state.phase === 'processing'));
  if (state.phase !== 'active' && state.phase !== 'processing') return null;
  const processing = state.phase === 'processing';
  const pins = emptyPinCount(state);
  const voiceProblem = state.voice.kind === 'refused' ? state.voice : undefined;
  return <Card size="sm" data-boring="feedback" data-feedback-ignore="" role="toolbar" aria-label="Feedback mode" data-testid="feedback-bar" data-docked={docked ? 'true' : 'false'}
    data-using={state.using ? 'true' : 'false'} data-recording={recording ? 'true' : 'false'} data-transcribing={state.transcribing ? 'true' : 'false'}
    className={['boring-feedback-bar', className].filter(Boolean).join(' ')}
    onKeyDown={event => { if (event.key === 'Escape' && state.bubble) { event.stopPropagation(); session.cancelBubble(); } }}>
    <span className="boring-feedback-bar-title">Feedback</span>
    <span className="boring-feedback-bar-meta" data-testid="feedback-bar-count">{plural(noteCount(state), 'note', 'notes')}{pins ? ` · ${plural(pins, 'pin', 'pins')}` : ''}</span>
    {state.voiceAvailable && <Toggle data-testid="feedback-voice" pressed={recording}
      disabled={processing || state.voice.kind === 'starting' || state.voice.kind === 'stopping'} title={recording ? 'Stop recording' : 'Record your voice while you point: each click drops a pin, what you say becomes its note'}
      onPressedChange={() => { void session.toggleVoice(); }}>
      {recording ? <><SquareIcon data-icon="inline-start" aria-hidden="true" />Stop</> : <><MicIcon data-icon="inline-start" aria-hidden="true" />{state.voice.kind === 'starting' ? 'Starting…' : state.voice.kind === 'stopping' ? 'Stopping…' : 'Record'}</>}
    </Toggle>}
    {recording && <Badge variant="destructive" role="status" data-testid="feedback-recording">
      <span className="boring-feedback-timer" data-testid="feedback-recording-time">{time}</span></Badge>}
    <span className="boring-feedback-hint" role="status" aria-live="polite" data-testid="feedback-bar-hint">{barHint(state)}</span>
    {voiceProblem && <span className="boring-feedback-voice-problem" role="alert" data-testid="feedback-voice-problem" data-code={voiceProblem.code}>{voiceProblem.reason}</span>}
    {!processing && <span className="boring-feedback-keys boring-feedback-alt">Hold ⌥ to use the app</span>}
    {!processing && <Toggle data-testid="feedback-use-app" pressed={state.useToggle} onPressedChange={pressed => session.setUseToggle(pressed)}>Use app</Toggle>}
    <Button variant="default" data-testid="feedback-done" disabled={processing} onClick={() => { void session.done(); }}>Done</Button>
    <Button variant="ghost" size="icon" data-testid="feedback-discard" aria-label="Discard feedback" title="Discard feedback" disabled={processing} onClick={() => session.discard()}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
  </Card>;
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
  return { position: 'fixed', top, left, width: Math.min(BUBBLE_WIDTH, width - 16), maxHeight: Math.max(0, height - top), overflowY: 'auto', boxSizing: 'border-box' };
}

type PinVoice = 'idle' | 'starting' | 'recording' | 'transcribing';

/**
 * The mic inside the pin's field: record, stop, and the transcript is appended to what is typed. A refused microphone, nothing heard or a
 * rejected transcription is said under the field and never touches the typed text. One capture (`createVoiceCapture`) per pin.
 */
function PinMic({ session, transcribe, words }: { readonly session: FeedbackSession; readonly transcribe: PinTranscribe; readonly words: FeedbackLabels }) {
  const [phase, setPhase] = useState<PinVoice>('idle');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const capture = useRef<VoiceCapture | null>(null);
  const run = useRef(0);
  const work = useRef<AbortController | null>(null);
  capture.current ??= createVoiceCapture();
  // A closed pin releases the microphone and drops a transcription still in flight.
  useEffect(() => () => { run.current += 1; capture.current?.cancel(); work.current?.abort(); }, []);
  const start = async (): Promise<void> => {
    const attempt = ++run.current;
    setProblem(undefined); setPhase('starting');
    // Called straight from the click, so the browser ties the permission prompt to the person's gesture.
    const result = await capture.current!.start();
    if (attempt !== run.current) return;
    if (result.kind === 'refused') { setPhase('idle'); setProblem(result.reason); return; }
    setPhase('recording');
  };
  const finish = async (): Promise<void> => {
    const attempt = run.current;
    setPhase('transcribing');
    const recording = await capture.current!.stop().catch(() => null);
    if (attempt !== run.current) return;
    if (!recording) { setPhase('idle'); setProblem(words.voiceNothing); return; }
    const abort = new AbortController();
    work.current = abort;
    try {
      const spoken = (await transcribe(recording.audio, abort.signal)).trim();
      if (attempt !== run.current) return;
      if (!spoken) { setProblem(words.voiceNothing); return; }
      // Appended to what is typed NOW (the person may have kept typing), never replacing it.
      const typed = session.getSnapshot().bubble?.text ?? '';
      session.setBubbleText(`${typed}${typed === '' || /\s$/.test(typed) ? '' : ' '}${spoken}`);
    } catch { if (attempt === run.current) setProblem(words.voiceFailed); }
    finally { if (work.current === abort) work.current = null; if (attempt === run.current) setPhase('idle'); }
  };
  const recording = phase === 'recording';
  return <>
    <Toggle className="boring-feedback-pin-mic" data-testid="feedback-bubble-mic" data-state={phase} pressed={recording}
      aria-label={recording ? words.voiceStop : words.voiceRecord} title={recording ? words.voiceStop : words.voiceRecord} disabled={phase === 'starting' || phase === 'transcribing'}
      onPressedChange={() => { if (phase === 'idle') void start(); else if (recording) void finish(); }}>
      {phase === 'transcribing' ? <span role="status" aria-label={words.voiceTranscribing}>…</span>
        : recording ? <SquareIcon data-icon="inline-start" aria-hidden="true" /> : <MicIcon data-icon="inline-start" aria-hidden="true" />}
    </Toggle>
    {problem && <span className="boring-feedback-voice-problem" role="alert" data-testid="feedback-bubble-voice-problem">{problem}</span>}
  </>;
}

/** Turns a recording into text (`signal` aborts when the pin closes); a rejection keeps what was typed. */
export type PinTranscribe = (audio: Blob, signal: AbortSignal) => Promise<string>;

const touchScreen = (): boolean => globalThis.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * The pin beside a picked element: a text field with a mic inside it, "Add note" (Enter) and Cancel (Esc). Enter saves, Shift-Enter for a
 * new line, Esc discards the pin. On desktop one line says that holding Alt passes clicks to the app. In point mode it keeps clear of
 * the PointBar. `transcribe` turns the mic's recording into text; without it there is no mic.
 */
export function NoteBubble({ session, labels, transcribe }: { readonly session: FeedbackSession; readonly labels?: Partial<FeedbackLabels>; readonly transcribe?: PinTranscribe }) {
  const state = useExternal(session);
  const words = withLabels(labels);
  const bubble = state.bubble;
  const field = useRef<HTMLTextAreaElement>(null);
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  const [, redraw] = useState(0);
  const [announce, setAnnounce] = useState('');
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
  useEffect(() => {
    if (!bubble) return;
    const view = bubble.element.ownerDocument.defaultView;
    const follow = () => { setPlace(bubblePlace(bubble.element, size())); redraw(value => value + 1); };
    view?.addEventListener('scroll', follow, { capture: true, passive: true });
    view?.addEventListener('resize', follow);
    return () => { view?.removeEventListener('scroll', follow, { capture: true }); view?.removeEventListener('resize', follow); };
  }, [bubble?.noteId, bubble?.element]);
  // A polite live region outlives the bubble, so the cancellation is heard even though the dialog is gone.
  const cancel = (): void => { session.cancelSelection(); setAnnounce(words.selectionCancelled); };
  const live = <span data-boring="feedback" data-feedback-ignore="" role="status" aria-live="polite" className="boring-feedback-sr" data-testid="feedback-bubble-announce"
    style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{announce}</span>;
  if (!bubble || state.phase !== 'active') return state.phase === 'active' ? live : null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.target === field.current) { event.preventDefault(); session.saveBubble(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); session.cancelBubble(); }
  };
  return <>{live}<Card size="sm" data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label={`Note ${bubble.number}`} data-testid="feedback-bubble" data-note={bubble.number}
    ref={box} className="boring-feedback-bubble" style={place} onKeyDown={onKeyDown}>
    <span className="boring-feedback-bubble-head"><span className="boring-feedback-pin" aria-hidden="true">{pinMark(bubble.number)}</span>
      <span className="boring-feedback-bubble-label" data-testid="feedback-bubble-label">{bubble.label}</span></span>
    <span className="boring-feedback-pin-field">
      <Textarea ref={field} data-testid="feedback-bubble-input" rows={2} placeholder={words.bubblePlaceholder} aria-label={words.bubblePlaceholder} value={bubble.text}
        onChange={event => session.setBubbleText(event.target.value)} />
      {transcribe && <PinMic key={bubble.noteId} session={session} transcribe={transcribe} words={words} />}
    </span>
    <span className="boring-feedback-bubble-actions">
      <Button variant="ghost" data-testid="feedback-cancel-selection" onClick={cancel}>{words.cancelSelection}</Button>
      <Button variant="default" data-testid="feedback-bubble-save" onClick={() => session.saveBubble()}>{words.add}</Button>
    </span>
    {!touchScreen() && <span className="boring-feedback-keys" data-testid="feedback-bubble-hint">{words.altHint}</span>}
  </Card></>;
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
    <Button variant="outline" className="min-w-0 max-w-full" data-testid="feedback-chip-open" aria-expanded={open} onClick={() => setOpen(value => !value)}
      title={refusal ?? 'Review your feedback before sending'}>
      <span aria-hidden="true">💬</span> Feedback · {plural(count, 'note', 'notes')}{pins ? ` · ${plural(pins, 'pin', 'pins')} to describe` : ''} · <span className="boring-feedback-chip-route">{state.route}</span>
    </Button>
    <Button variant="ghost" size="icon-sm" data-testid="feedback-chip-discard" aria-label="Discard feedback" title="Discard feedback" onClick={() => { session.highlight(undefined); session.discard(); }}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
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
  return <Card size="sm" data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label="Review feedback" data-testid="feedback-review" className="boring-feedback-review"
    style={place} onKeyDown={onKeyDown} onMouseLeave={() => hover(undefined)}>
    <header className="boring-feedback-sheet-header"><h2>Feedback · {state.route}</h2>
      <Button variant="ghost" size="icon" aria-label="Close review" title="Close review" data-testid="feedback-review-close" onClick={onClose}><XIcon data-icon="inline-start" aria-hidden="true" /></Button></header>
    {state.problem && <p className="boring-feedback-warning" role="alert" data-testid="feedback-review-problem">{state.problem}</p>}
    <ol className="boring-feedback-notes">
      {state.notes.map(note => <li key={note.id} data-testid="feedback-review-note" data-note={note.number} data-where={where[note.id]}
        onMouseEnter={() => hover(note.id)} onFocus={() => hover(note.id)}>
        <span className="boring-feedback-note-head"><span className="boring-feedback-pin" aria-hidden="true">{pinMark(note.number)}</span>
          <ElementName note={note} />
          {note.from === 'voice' && <Badge variant="secondary" data-testid="feedback-review-voice">voice</Badge>}
          {where[note.id] === 'not-on-page' && <Badge variant="secondary" data-testid="feedback-review-elsewhere">not on this page</Badge>}
          <Button variant="ghost" size="icon" aria-label={`Remove note ${note.number}`} title={`Remove note ${note.number}`} data-testid="feedback-review-remove" onClick={() => session.removeNote(note.id)}><XIcon data-icon="inline-start" aria-hidden="true" /></Button></span>
        <Textarea rows={2} aria-label={`Note ${note.number}`} data-testid="feedback-review-text" value={note.text} placeholder={note.recorded ? 'Nothing was said here: type a note, or remove the pin' : undefined}
          onChange={event => session.setNoteText(note.id, event.target.value)} />
      </li>)}
    </ol>
    <label className="boring-feedback-field"><span>General note</span>
      <Textarea rows={2} data-testid="feedback-review-general" placeholder="Anything else? (optional)" value={state.general} onChange={event => session.setGeneral(event.target.value)} /></label>
    <p className="boring-feedback-meta">{state.stepCount > 1 ? `${plural(state.stepCount, 'step', 'steps')} recorded between the notes. ` : ''}{copy ? 'Copy the report and paste it anywhere.' : 'Sent with your next message.'}</p>
    {copy && <div className="boring-feedback-actions">
      <Button variant="default" data-testid="feedback-copy" onClick={() => { void session.copy(); }}>Copy report</Button></div>}
    {copy && <p role="status" aria-live="polite" className="boring-feedback-status" data-testid="feedback-status" data-copy={state.copy.kind}>
      {state.copy.kind === 'copied' ? 'Report copied. Paste it anywhere.' : state.copy.kind === 'manual' ? 'The clipboard is not available here: select the report below and copy it.' : state.copy.kind === 'refused' ? state.copy.reason : ''}</p>}
    {copy && state.copy.kind === 'manual' && <Textarea readOnly className="boring-feedback-manual" data-testid="feedback-manual-copy" value={state.copy.text} rows={6} onFocus={event => event.currentTarget.select()} />}
    {copy && state.copy.kind === 'copied' && <details className="boring-feedback-copied"><summary>Copied report</summary><pre data-testid="feedback-copy-text">{state.copy.text}</pre></details>}
  </Card>;
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
  readonly annotate: () => void;
  readonly active: boolean;
  readonly count: number;
  readonly clear: () => void;
  readonly attach: (text: string) => Promise<{ readonly kind: 'ok'; readonly text: string } | { readonly kind: 'refused'; readonly reason: string }>;
  readonly sent: () => void;
}

/** A Markdown fence longer than any backtick run in the text. */
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}markdown\n${text.endsWith('\n') ? text : `${text}\n`}${fence}`;
}

/** Touch or a compact screen: the panel covers the app and there is no hover, so annotating is point mode (use the app, then point). */
function pointsInstead(): boolean {
  return globalThis.matchMedia?.('(pointer: coarse)').matches === true || (globalThis.innerWidth ?? 1024) < 768;
}

/**
 * Starts (or resumes) annotating in either mode, with Esc as a way out. The session swallows Esc on the page (it only closes a pin), so
 * this listens on the window's capture phase BEFORE the session starts, and ends the mode (Done: the notes wait for Send) when no pin is
 * open. From the review, `resume` keeps the notes, anchors and save guards: a second round adds to the same draft.
 */
function startAnnotating(session: FeedbackSession): void {
  const view = globalThis.window;
  const onKey = (event: globalThis.KeyboardEvent): void => {
    // Esc that ends annotating is spent: a host layer around the composer (a panel that closes on Esc) must not also react to it.
    if (event.key === 'Escape' && !session.getSnapshot().bubble) { event.preventDefault(); event.stopPropagation(); void session.done(); }
  };
  view?.addEventListener('keydown', onKey, { capture: true });
  session.resume(pointsInstead() ? { mode: 'point' } : {});
  const stop = session.subscribe(() => {
    if (session.getSnapshot().phase === 'active') return;
    view?.removeEventListener('keydown', onKey, { capture: true });
    stop();
  });
}

/**
 * The composer's `feedback` prop for a session: ONE annotate toggle (targeting with a hover highlight; point mode on touch and compact
 * screens, and again after Esc to add more), a count of the notes taken, and Send attaching them: a saved report as its `@` mention (the host's mention resolver inlines
 * the stored report with the person's access), otherwise the rendered report inline in a fenced block. Pair it with `NoteBubble`.
 */
export function useComposerFeedback(session: FeedbackSession | undefined): ComposerFeedbackProp | undefined {
  const state = useSyncState(session);
  if (!session || !state) return undefined;
  const open = state.phase === 'active' || state.phase === 'processing';
  return {
    annotate: () => {
      const phase = session.getSnapshot().phase;
      if (phase === 'active') void session.done();
      else if (phase === 'idle' || phase === 'review') startAnnotating(session);
    },
    active: open,
    // A note being typed in the pin counts: Send saves it.
    count: noteCount(state) + (state.bubble?.fresh && state.bubble.text.trim() ? 1 : 0),
    clear: () => { session.highlight(undefined); session.discard(); },
    attach: async text => {
      // Send while annotating ends it first: the pin being typed is kept.
      if (session.getSnapshot().phase === 'active') await session.done();
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
