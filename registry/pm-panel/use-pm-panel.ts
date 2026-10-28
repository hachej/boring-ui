'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { anchorOf, createOverlay, createPicker, createPrivacyPolicy } from '@hachej/boring-feedback/page';
import type { PrivacyPolicy, SpeechSegment } from '@hachej/boring-feedback/page';
import { useVoiceAttempt } from '@hachej/boring-ui-kit/chat-react/voice';
import { appendToDraft, voiceRefusalLabel } from '@hachej/boring-ui-kit/chat-text';
import type { VoiceMessageHandle, VoiceMessageConfig } from '../pi-chat/config';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { frenchChatLabels } from '../pi-chat/labels-fr';
import { feedbackLabels, feedbackLabelsFr } from '../feedback/feedback-labels';
import type { PointChip } from './point-state';
import { alignedTranscript, createPointState, marker, pointReducer, renumberText } from './point-state';
import { pmTextFor } from './pm-text';
import { captureElement } from './capture';
import { POINT_PREFACE } from './point-message';

export interface PmTranscript { readonly text: string; readonly segments?: readonly SpeechSegment[] }
/** Optional host voice enrichment. Authorization, retention and transcription remain with the host. */
export interface PmVoice {
  readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string | PmTranscript>;
  readonly maxMs?: number;
  /** Optional live text with timings. The returned cleanup releases only this capture's listener. */
  readonly live?: (signal: AbortSignal, update: (transcript: PmTranscript) => void) => (() => void);
}
export interface ImproveSpec {
  readonly controller: NativeChatController;
  readonly chatProps?: Omit<PiChatProps, 'controller'>;
  readonly label?: string;
  /** The app's name in the full panel's subtitle: « Le chef de projet · {appName} ». */
  readonly appName?: string;
  readonly voice?: VoiceMessageConfig & { readonly send?: 'auto' | 'draft' | 'message' };
  readonly feedback?: import('@hachej/boring-feedback/ui').FeedbackSession;
  readonly policy?: PrivacyPolicy;
  readonly pointVoice?: PmVoice;
  readonly tasks?: StudioTaskBoardSeam;
}
/**
 * The app's task board (`task-board` item): the host's authorized records. The panel draws « Mes demandes » with `TaskBoard` and the @
 * picker with `task-mentions` from them; it owns no card, board or task store.
 */
export interface StudioTaskBoardSeam {
  readonly tasks: readonly import('@hachej/boring-ui-kit/task-board').TaskRecord[];
  /** The viewer: « Mes demandes » and @ show the tasks they requested (`requesterId`). */
  readonly currentUser: string;
  /** Opens a task: the @ chip, a card in « Mes demandes ». */
  readonly onOpen: (task: import('@hachej/boring-ui-kit/task-board').TaskRecord) => void;
  /** Host-authorized compact card actions in « Mes demandes » (`TaskBoard cardActions`). */
  readonly cardActions?: (task: import('@hachej/boring-ui-kit/task-board').TaskRecord) => import('react').ReactNode;
  /** The request card under a PM reply (C7, `TaskRequestCard variant="compact"`), or undefined when that reply carries no request. `edit` puts the request text back in the composer (« Modifier »). */
  readonly renderRequest?: (context: { readonly entry: import('@earendil-works/pi-durable').EntryRecord; readonly edit: (text: string) => void }) => import('react').ReactNode;
}

interface CaptureBatch {
  readonly context: object;
  readonly controller: NativeChatController;
  readonly ids: readonly string[];
  readonly text: string;
  readonly speech: PmTranscript;
  readonly priorRequestId: string | undefined;
  requestId?: string;
}
const defaultPolicy = createPrivacyPolicy();
const NOTHING = new Error('nothing heard');
/** The picker's overlay is the pin layer's host only while picking; pins are drawn by the overlay below (corner pins, the element's radius). */
const PICK_STYLES = '.box[data-tone="pinned"] { display: none; } .label { display: none; } .box[data-tone="hover"] { border-width: var(--pm-mark-width); } @media (hover: none) { .box[data-tone="hover"] { display: none; } }';
/** Pins: a circle centred on the element's top-right corner, accent fill, contrasting number (spec R3); the accent outline (35% app, 60% Studio) and a light fill. Every value is a theme token. */
const PIN_STYLES = '.box { border-style: solid; border-width: var(--pm-mark-width); border-color: color-mix(in srgb, var(--pm-mark) var(--pm-mark-line), transparent); background: color-mix(in srgb, var(--pm-mark) 6%, transparent); }'
  + ' .label { box-sizing: border-box; min-width: 24px; height: 24px; padding: 0 7px; border-radius: var(--pm-radius-round); display: flex; align-items: center; justify-content: center;'
  + ' background: var(--pm-mark); color: var(--pm-mark-foreground); font-family: var(--font-sans, inherit); font-size: 12px; font-weight: 700; line-height: 1; transform: translate(-50%, -50%); }';
/** A tap lands on the innermost node; the pick is the nearest element a person would name (a card, a gauge, a button, a field). */
const NAMED = 'button, a[href], input, select, textarea, img, svg[role], [role=meter], [role=progressbar], [role=article], article, [role=region], [role=group], [role=listitem], li, [role=button], [role=link], [role=img], [aria-label]';
function meaningful(element: Element, root: Element): Element {
  const named = element.closest(NAMED);
  return named && root.contains(named) ? named : element;
}
function headingOf(element: Element): string | undefined {
  const heading = element.querySelector('h1, h2, h3, h4, h5, h6, [role=heading]')?.textContent?.trim();
  return heading || undefined;
}
function keepMarkers(controller: NativeChatController, chips: readonly PointChip[]) {
  const text = controller.getSnapshot().draft.text;
  const missing = chips.filter(chip => !text.includes(marker(chip.number))).map(chip => marker(chip.number)).join(' ');
  if (missing) controller.setText(appendToDraft(text, missing));
}

const ADD_TO_MESSAGE = 'boring-ui.pm.add-to-message';
const readAddToMessage = () => { try { return localStorage.getItem(ADD_TO_MESSAGE) === '1'; } catch { return false; } };

/** The open click-to-comment popover (spec 1 §3b): the pick it comments on, the field and the two ways out. */
export interface PmComment {
  readonly chip: PointChip;
  readonly element: Element;
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly addToMessage: boolean;
  readonly setAddToMessage: (value: boolean) => void;
  /** Enter or the send button: straight to the PM, or into the draft when « Ajouter au message » is checked. */
  readonly submit: () => void;
  /** A click outside: an empty field cancels the pick, text goes into the draft. */
  readonly outside: () => void;
  readonly transcribe: ((audio: Blob, signal: AbortSignal) => Promise<string>) | undefined;
}

/** `comment`: a click in `point.idle` opens the comment popover at the pin (the desktop preset, spec 1 §3b). */
export function usePmPanel(spec: ImproveSpec, open: boolean, page: HTMLElement | null, screen = 'app', { comment: commenting = false }: { readonly comment?: boolean } = {}) {
  const text = pmTextFor(spec.chatProps?.locale);
  const [announcement, setAnnouncement] = useState('');
  const [state, dispatch] = useReducer(pointReducer, undefined, createPointState);
  const [problem, setProblem] = useState<string>();
  const [live, setLive] = useState<PmTranscript>({ text: '' });
  const [dictated, setDictated] = useState<number>();
  const [speech, setSpeech] = useState<PmTranscript>({ text: '' });
  const [focusVersion, setFocusVersion] = useState(0);
  const latest = useRef({ spec, state, open, dictated, speech });
  const mounted = useRef(false), pendingBatch = useRef<CaptureBatch | undefined>(undefined), batchSequence = useRef(0);
  const batchPrefix = useId();
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { latest.current = { spec, state, open, dictated, speech }; });
  const snapshot = useSyncExternalStore(spec.controller.subscribe, spec.controller.getSnapshot, spec.controller.getSnapshot);
  const policy = spec.policy ?? defaultPolicy;
  const voiceConfig = spec.pointVoice ?? spec.voice;
  const core = useVoiceAttempt<{ readonly controller: NativeChatController; readonly config: PmVoice; readonly offset: number; readonly priorSpeech: PmTranscript }>({
    valid: item => latest.current.open && latest.current.spec.controller === item.controller,
    refused: refusal => setProblem(frenchChatLabels[voiceRefusalLabel[refusal.code ?? 'failed']]),
  });
  const coreRef = useRef(core);
  useLayoutEffect(() => { coreRef.current = core; });
  // Esc = « ✓ Terminer » while the strip shows (spec 1 §1): it keeps and transcribes the recording. Registered in a layout effect at mount, so it
  // runs before the voice attempt's own Escape (which cancels a plain dictation) and the picker's; elsewhere Escape keeps their meaning.
  const pointingRef = useRef(false), returnRef = useRef<() => void>(() => {}), removeRef = useRef<(id: string) => void>(() => {});
  // The open comment popover: Esc cancels its pick first; the strip's × is the second Esc.
  const commentRef = useRef<{ readonly id: string; readonly cancel: () => void; readonly outside: () => void } | undefined>(undefined);
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || !pointingRef.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (commentRef.current) commentRef.current.cancel(); else returnRef.current();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
  const item = core.attempts[0];
  const recording = item?.phase === 'recording' || item?.phase === 'starting';
  const cancel = useCallback(() => {
    const attempt = coreRef.current.current()[0], current = latest.current;
    if (attempt?.controller === current.spec.controller) keepMarkers(attempt.controller, current.state.chips);
    coreRef.current.clear(); setLive({ text: '' });
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a close releases this viewer's microphone and live transcript once, never native work
  useEffect(() => { if (!open) cancel(); }, [open, cancel]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a new borrowed controller fences and releases the old viewer's capture once
  useEffect(() => { dispatch({ type: 'return' }); cancel(); }, [spec.controller, cancel]);
  useEffect(() => { if (open) dispatch({ type: 'return' }); }, [open]);
  useEffect(() => {
    if (!item || !item.config.live) return;
    return item.config.live(item.abort.signal, transcript => { if (coreRef.current.valid(item)) setLive(transcript); });
  }, [item]);
  const start = useCallback(() => {
    const current = latest.current, api = coreRef.current;
    const config = current.spec.pointVoice ?? current.spec.voice;
    if (!config || api.current().length || !current.open) return;
    setProblem(undefined); setLive({ text: '' });
    api.start({ controller: current.spec.controller, config, offset: current.dictated ?? 0, priorSpeech: current.speech }, config.maxMs);
  }, []);
  const finish = useCallback(() => {
    const api = coreRef.current, attempt = api.current()[0];
    if (!attempt) return;
    dispatch({ type: 'return' });
    if (attempt.phase === 'processing') return;
    if (attempt.phase === 'starting') { keepMarkers(attempt.controller, latest.current.state.chips); api.remove(attempt); setFocusVersion(value => value + 1); return; }
    void (async () => {
      try {
        const audio = await api.stop(attempt);
        if (!api.valid(attempt)) return;
        if (!audio) throw NOTHING;
        const result = await attempt.config.transcribe(audio.audio, attempt.abort.signal);
        if (!api.valid(attempt)) return;
        const transcript = typeof result === 'string' ? { text: result } : result;
        if (!transcript.text.trim()) throw NOTHING;
        const current = latest.current;
        const typed = attempt.controller.getSnapshot().draft.text;
        const timed = current.state.chips.filter(chip => !typed.includes(marker(chip.number))).map(chip => ({ ...chip, at: chip.at === null ? null : Math.max(0, chip.at - attempt.offset) }));
        const words = alignedTranscript(transcript.text.trim(), transcript.segments, timed);
        attempt.controller.setText(appendToDraft(attempt.controller.getSnapshot().draft.text, words));
        const segments = transcript.segments?.map(segment => ({ ...segment, start: segment.start + attempt.offset, end: segment.end + attempt.offset,
          ...(segment.words ? { words: segment.words.map(word => ({ ...word, start: word.start + attempt.offset, end: word.end + attempt.offset })) } : {}) }));
        setDictated(attempt.offset + (audio.endedAt - audio.startedAt) / 1000);
        setSpeech({ text: appendToDraft(attempt.priorSpeech.text, transcript.text), segments: [...(attempt.priorSpeech.segments ?? []), ...(segments ?? [])] }); setLive({ text: '' }); setFocusVersion(value => value + 1); dispatch({ type: 'return' });
      } catch (error) {
        if (!api.valid(attempt)) return;
        // Nothing said: the picks (if any) become chips, the draft is otherwise untouched, and that is not a failure.
        keepMarkers(attempt.controller, latest.current.state.chips); setFocusVersion(value => value + 1);
        if (error !== NOTHING) setProblem('La transcription a échoué. Vos éléments et votre texte sont conservés.');
      }
      finally { if (api.valid(attempt)) api.remove(attempt); }
    })();
  }, []);
  const voice: VoiceMessageHandle = {
    canStart: Boolean(voiceConfig) && open && snapshot.connection.kind === 'connected' && snapshot.send.kind !== 'unknown' && snapshot.send.kind !== 'submitting' && snapshot.send.kind !== 'validating', phase: item?.phase ?? 'idle', seconds: item?.seconds ?? 0,
    captureSequence: core.captureSequence, levels: item?.levels ?? [], paused: item?.paused ?? false, pending: [], problem,
    start, finish, cancel,
    ...(item?.canPause ? { pause: () => core.pause(item), resume: () => core.resume(item) } : {}),
  };
  const [commentAt, setCommentAt] = useState<{ readonly id: string; readonly element: Element }>();
  const [commentText, setCommentText] = useState('');
  const [addToMessage, setAddToMessageState] = useState(readAddToMessage);
  const [sentNotice, setSentNotice] = useState(0);
  const commentingRef = useRef(commenting);
  useLayoutEffect(() => { commentingRef.current = commenting; });
  const selectedElements = useRef(new Map<string, Element>());
  const anchors = useRef(new Map<string, import('@hachej/boring-feedback/page').AppElementAnchor>());
  const selectionRoot = page?.closest('[data-pm-layout]') ?? page;
  useEffect(() => {
    if (!open || !state.show || state.mode !== 'point' || !selectionRoot) return;
    const picker = createPicker({ root: selectionRoot, policy, styles: PICK_STYLES, tap: 'pick', wheel: false, keys: 'outside-ignored',
      onPick: picked => {
      // With the comment popover open, a click on the page is a click outside it: it settles that pick and picks nothing.
      if (commentRef.current) { commentRef.current.outside(); return; }
      const element = meaningful(picked, selectionRoot);
      // Tapping an already picked element removes that pick.
      for (const [id, chosen] of selectedElements.current) if (chosen === element) { removeRef.current(id); return; }
      if (latest.current.state.chips.length >= 20) { setProblem('20 éléments maximum par message.'); return; }
      const capture = anchorOf(element, policy, { root: selectionRoot });
      if (capture.kind !== 'captured') { setProblem('Cet élément ne peut pas être joint.'); return; }
      try {
        const anchor = capture.anchor, image = captureElement(element, policy), box = element.getBoundingClientRect();
        const id = `pm-${++sequence.current}`, number = latest.current.state.nextNumber;
        const words = text.locale === 'en' ? feedbackLabels : feedbackLabelsFr;
        const role = anchor.signals.role ?? element.localName, unknown = words.element(undefined, undefined), named = words.element(role, undefined);
        const kind = named === unknown ? (text.locale === 'en' ? 'Text' : 'Texte') : named;
        const name = anchor.signals.name ?? headingOf(element) ?? kind;
        const label = name.length > 40 ? `${name.slice(0, 39)}…` : name;
        const controller = latest.current.spec.controller;
        controller.setAttachments([...controller.getSnapshot().draft.attachments, { id, name: `${marker(number)} @ ${kind} · ${label} · capture jointe`, content: { type: 'image', ...image } }]);
        selectedElements.current.set(id, element); anchors.current.set(id, anchor);
        const attempt = coreRef.current.current()[0];
        const recordingNow = attempt?.phase === 'recording' || attempt?.phase === 'starting';
        const at = recordingNow ? (attempt.offset ?? 0) + (attempt.capture.progress()?.elapsedMs ?? 0) / 1000 : null;
        dispatch({ type: 'pick', chip: { id, kind, label, screen, at, box: [box.x, box.y, box.width, box.height] } });
        // While recording the voice is the comment: the click only pins.
        if (commentingRef.current && !recordingNow) { setCommentText(''); setCommentAt({ id, element }); }
        setAnnouncement(text.added(number, kind, label));
        setProblem(undefined);
      } catch { setProblem('La capture de cet élément est indisponible. Réessayez.'); }
    } });
    void picker.start();
    return () => picker.dispose();
  }, [open, state.show, state.mode, policy, selectionRoot, page, screen, text]);
  const sequence = useRef(0);
  // Messages sent from the popover: the app panel stays on the strip when they are admitted (no C7).
  const quietTexts = useRef(new Set<string>());
  useEffect(() => {
    if (!sentNotice) return;
    const timer = setTimeout(() => setSentNotice(0), 3000);
    return () => clearTimeout(timer);
  }, [sentNotice]);
  // Native attachment remove controls also remove the corresponding marker and pin.
  useEffect(() => {
    for (const chip of state.chips) if (!pendingBatch.current?.ids.includes(chip.id) && !snapshot.draft.attachments.some(attachment => attachment.id === chip.id) && snapshot.send.kind !== 'submitting' && snapshot.send.kind !== 'unknown' && snapshot.send.kind !== 'validating') {
      dispatch({ type: 'remove', id: chip.id }); selectedElements.current.delete(chip.id); anchors.current.delete(chip.id);
    }
  }, [snapshot.draft.attachments, snapshot.send.kind, state.chips]);
  useEffect(() => {
    // Pins stay while the page is visible (strip and review); the full panel covers the page. A pin shows only on its own screen.
    if (!open || state.mode === 'full' || !state.chips.length || !selectionRoot) return;
    // Mounted beside the picked area (never inside it), so the pins read the host surface's theme tokens.
    const overlay = createOverlay({ document: selectionRoot.ownerDocument, styles: PIN_STYLES, labels: 'corner', shape: 'element', mount: selectionRoot.parentElement ?? selectionRoot.ownerDocument.body, ...(page ? { clip: page } : {}) });
    const elements = new Map<Element, string[]>();
    for (const chip of state.chips) {
      const element = selectedElements.current.get(chip.id);
      if (!element?.isConnected || !element.getClientRects().length) continue;
      elements.set(element, [...(elements.get(element) ?? []), String(chip.number)]);
    }
    overlay.draw([...elements].map(([element, numbers]) => ({ element, label: numbers.join(' '), tone: 'hover' as const })));
    return () => overlay.dispose();
  }, [open, state.mode, state.chips, selectionRoot, screen, page]);
  const completeBatch = useCallback((batch: CaptureBatch) => {
    if (!mounted.current || latest.current.spec.controller !== batch.controller || pendingBatch.current !== batch) return;
    pendingBatch.current = undefined;
    dispatch({ type: 'sent', ids: batch.ids });
    if (latest.current.speech === batch.speech) { setDictated(undefined); setSpeech({ text: '' }); }
    for (const id of batch.ids) { selectedElements.current.delete(id); anchors.current.delete(id); }
  }, []);
  const sendContext = useMemo(() => {
    const context = {};
    return {
      count: state.chips.length || (dictated !== undefined ? 1 : 0),
      attach: (text: string) => {
        if (pendingBatch.current) return Promise.resolve({ kind: 'refused' as const, reason: 'Vérifiez d’abord le message en cours.' });
        const payload = { format: 'pm.points@1', captureBatch: `${batchPrefix}-${++batchSequence.current}`, dictatedSeconds: dictated, dictatedMs: dictated === undefined ? undefined : Math.round(dictated * 1000),
          transcriptSegments: speech.segments ?? [], alignment: speech.segments?.some(segment => segment.words?.length) ? 'word' : speech.segments?.length ? 'segment' : 'unavailable',
          policy: { version: policy.version, widened: policy.widened }, selections: state.chips.map(({ id, number, kind, label, screen, at }) => ({ n: number, kind, label, screen,
            atMs: at === null ? null : Math.round(at * 1000), t: at === null ? null : Math.round(at * 1000), selector: anchors.current.get(id)?.signals.path.join(' > '), screenshot: { imageIndex: snapshot.draft.attachments.findIndex(image => image.id === id), mimeType: snapshot.draft.attachments.find(image => image.id === id)?.content.mimeType }, anchor: anchors.current.get(id) })) };
        const attached = appendToDraft(text, `${POINT_PREFACE}${JSON.stringify(payload)}`);
        const selected: CaptureBatch = { context, controller: spec.controller, ids: state.chips.map(chip => chip.id), text: attached, speech,
          priorRequestId: 'attempt' in snapshot.send ? snapshot.send.attempt.requestId : undefined };
        pendingBatch.current = selected;
        return Promise.resolve({ kind: 'ok' as const, text: attached });
      },
      sent: () => { const selected = pendingBatch.current; if (selected?.context === context) completeBatch(selected); },
    };
  }, [state.chips, dictated, policy, speech, snapshot.draft.attachments, snapshot.send, spec.controller, batchPrefix, completeBatch]);
  // Reconciliation observes the original native request; it is never another send or a second admission authority.
  useEffect(() => {
    const batch = pendingBatch.current;
    if (!batch || batch.controller !== spec.controller) return;
    if ('attempt' in snapshot.send && snapshot.send.attempt.draft.text === batch.text && snapshot.send.attempt.requestId !== batch.priorRequestId) {
      batch.requestId ??= snapshot.send.attempt.requestId;
      if (snapshot.send.kind === 'admitted' && batch.requestId === snapshot.send.attempt.requestId) completeBatch(batch);
    } else if (snapshot.send.kind === 'blocked') pendingBatch.current = undefined;
  }, [snapshot.send, spec.controller, completeBatch]);
  const liveText = recording ? alignedTranscript(live.text, live.segments, state.chips.filter(chip => !snapshot.draft.text.includes(marker(chip.number))).map(chip => ({ ...chip, at: chip.at === null ? null : Math.max(0, chip.at - (item?.offset ?? 0)) }))) : '';
  const remove = (id: string) => {
    const chip = state.chips.find(value => value.id === id);
    if (!chip) return;
    const draft = spec.controller.getSnapshot().draft;
    spec.controller.setText(renumberText(draft.text, chip.number));
    // Attachment names carry the marker too: they follow the renumbering.
    spec.controller.setAttachments(draft.attachments.filter(image => image.id !== id).map(image => {
      const other = state.chips.find(value => value.id === image.id);
      return other && other.number > chip.number ? { ...image, name: image.name.replace(marker(other.number), marker(other.number - 1)) } : image;
    }));
    dispatch({ type: 'remove', id }); selectedElements.current.delete(id); anchors.current.delete(id);
    setAnnouncement(text.removed(chip.number));
  };
  const commentId = commentAt?.id;
  const commentChip = commentId ? state.chips.find(chip => chip.id === commentId) : undefined;
  const closeComment = () => { commentRef.current = undefined; setCommentAt(undefined); setCommentText(''); };
  const cancelComment = () => { if (commentId) remove(commentId); closeComment(); };
  // « Ajouter au message », or a click outside with text: the chip, then the text after it, in the draft (spec 1 §3b).
  const keepComment = () => {
    if (!commentChip) return;
    const draft = spec.controller.getSnapshot().draft.text, words = commentText.trim();
    spec.controller.setText(appendToDraft(draft, words ? `${marker(commentChip.number)} ${words}` : marker(commentChip.number)));
    closeComment();
  };
  // Straight to the PM: the comment and its one chip, the capture and that pick, as their own message; the draft keeps everything else.
  const sendComment = () => {
    const words = commentText.trim();
    if (!commentChip || !words) return;
    const image = spec.controller.getSnapshot().draft.attachments.find(attachment => attachment.id === commentChip.id);
    const anchor = anchors.current.get(commentChip.id);
    const payload = { format: 'pm.points@1', captureBatch: `${batchPrefix}-${++batchSequence.current}`, transcriptSegments: [], alignment: 'unavailable', policy: { version: policy.version, widened: policy.widened },
      selections: [{ n: 1, kind: commentChip.kind, label: commentChip.label, screen: commentChip.screen, atMs: null, t: null, selector: anchor?.signals.path.join(' > '),
        screenshot: { imageIndex: image ? 0 : -1, mimeType: image?.content.mimeType }, anchor }] };
    const message = `${words} ${marker(1)}\n${POINT_PREFACE}${JSON.stringify(payload)}`;
    remove(commentChip.id); closeComment();
    quietTexts.current.add(message);
    const controller = spec.controller;
    void controller.send('followUp', { text: message, attachments: image ? [{ ...image, name: image.name.replace(marker(commentChip.number), marker(1)) }] : [], restore: { text: words } })
      .then(submission => { if (submission && mounted.current) setSentNotice(value => value + 1); }, () => { if (mounted.current) setProblem('L’envoi a échoué. Votre commentaire est dans le brouillon.'); });
  };
  const setAddToMessage = (value: boolean) => {
    setAddToMessageState(value);
    try { localStorage.setItem(ADD_TO_MESSAGE, value ? '1' : '0'); } catch { /* the choice lasts this session */ }
  };
  const comment: PmComment | undefined = commentChip && commentAt ? {
    chip: commentChip, element: commentAt.element, text: commentText, setText: setCommentText, addToMessage, setAddToMessage,
    submit: () => { if (addToMessage) keepComment(); else sendComment(); },
    outside: () => { if (commentText.trim()) keepComment(); else cancelComment(); },
    transcribe: voiceConfig ? async (audio, signal) => { const result = await voiceConfig.transcribe(audio, signal); return typeof result === 'string' ? result : result.text; } : undefined,
  } : undefined;
  // The popover's pick went away (sent, removed or the panel closed): nothing is left to comment on.
  if (commentAt && (!commentChip || !open || state.mode !== 'point')) setCommentAt(undefined);
  const returnToComposer = () => {
    // × settles an open popover like a click outside it; a cancelled pick gets no marker.
    const cancelled = comment && !comment.text.trim() ? comment.chip.id : undefined;
    comment?.outside();
    if (recording) { finish(); return; }
    keepMarkers(spec.controller, state.chips.filter(chip => chip.id !== cancelled));
    dispatch({ type: 'return' }); setFocusVersion(value => value + 1);
  };
  useLayoutEffect(() => {
    returnRef.current = returnToComposer; removeRef.current = remove; pointingRef.current = open && (state.mode === 'point' || state.mode === 'navigate');
    commentRef.current = comment ? { id: comment.chip.id, cancel: cancelComment, outside: comment.outside } : undefined;
  });
  const quietSend = useCallback((text: string | undefined) => text !== undefined && quietTexts.current.has(text), []);

  // The meta line under the draft (spec 1 §5): dictated time and captures, « Écrit · n captures » without dictation, nothing with neither.
  const meta = dictated !== undefined || state.chips.length ? text.meta(dictated, state.chips.length) : undefined;
  return { state, dispatch, voice, recording, problem, liveText, sendContext, dictated, snapshot, remove, returnToComposer, focusVersion, text, meta, announcement, comment, sent: sentNotice > 0, quietSend };
}

export type PmPanelState = ReturnType<typeof usePmPanel>;
