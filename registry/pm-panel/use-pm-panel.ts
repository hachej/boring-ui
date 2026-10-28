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
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import type { PointChip } from './point-state';
import { alignedTranscript, createPointState, marker, pointReducer } from './point-state';
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
  readonly voice?: VoiceMessageConfig & { readonly send?: 'auto' | 'draft' | 'message' };
  readonly feedback?: import('@hachej/boring-feedback/ui').FeedbackSession;
  readonly policy?: PrivacyPolicy;
  readonly pointVoice?: PmVoice;
  readonly tasks?: StudioTaskBoardSeam;
  readonly taskMentions?: import('./task-mentions').TaskMentionSource;
}
/** D-417 / PR #1900 owns these components; this is deliberately not another card or board. */
export interface StudioTaskBoardSeam {
  readonly renderBoard: (options: { readonly filter: 'mine'; readonly variant: 'full' | 'compact'; readonly limit?: number }) => import('react').ReactNode;
  readonly renderRequest?: () => import('react').ReactNode;
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
function keepMarkers(controller: NativeChatController, chips: readonly PointChip[]) {
  const text = controller.getSnapshot().draft.text;
  const missing = chips.filter(chip => !text.includes(marker(chip.number))).map(chip => marker(chip.number)).join(' ');
  if (missing) controller.setText(appendToDraft(text, missing));
}

export function usePmPanel(spec: ImproveSpec, open: boolean, page: HTMLElement | null, screen = 'app') {
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
        if (!audio) throw new Error('Rien n’a été entendu.');
        const result = await attempt.config.transcribe(audio.audio, attempt.abort.signal);
        if (!api.valid(attempt)) return;
        const transcript = typeof result === 'string' ? { text: result } : result;
        if (!transcript.text.trim()) throw new Error('Rien n’a été entendu.');
        const current = latest.current;
        const typed = attempt.controller.getSnapshot().draft.text;
        const timed = current.state.chips.filter(chip => !typed.includes(marker(chip.number))).map(chip => ({ ...chip, at: Math.max(0, chip.at - attempt.offset) }));
        const words = alignedTranscript(transcript.text.trim(), transcript.segments, timed);
        attempt.controller.setText(appendToDraft(attempt.controller.getSnapshot().draft.text, words));
        const segments = transcript.segments?.map(segment => ({ ...segment, start: segment.start + attempt.offset, end: segment.end + attempt.offset,
          ...(segment.words ? { words: segment.words.map(word => ({ ...word, start: word.start + attempt.offset, end: word.end + attempt.offset })) } : {}) }));
        setDictated(attempt.offset + (audio.endedAt - audio.startedAt) / 1000);
        setSpeech({ text: appendToDraft(attempt.priorSpeech.text, transcript.text), segments: [...(attempt.priorSpeech.segments ?? []), ...(segments ?? [])] }); setLive({ text: '' }); setFocusVersion(value => value + 1); dispatch({ type: 'return' });
      } catch { if (api.valid(attempt)) { keepMarkers(attempt.controller, latest.current.state.chips); setFocusVersion(value => value + 1); setProblem('La transcription a échoué. Vos éléments et votre texte sont conservés.'); } }
      finally { if (api.valid(attempt)) api.remove(attempt); }
    })();
  }, []);
  const voice: VoiceMessageHandle = {
    canStart: Boolean(voiceConfig) && open && snapshot.connection.kind === 'connected' && snapshot.send.kind !== 'unknown' && snapshot.send.kind !== 'submitting' && snapshot.send.kind !== 'validating', phase: item?.phase ?? 'idle', seconds: item?.seconds ?? 0,
    captureSequence: core.captureSequence, levels: item?.levels ?? [], paused: item?.paused ?? false, pending: [], problem,
    start, finish, cancel,
    ...(item?.canPause ? { pause: () => core.pause(item), resume: () => core.resume(item) } : {}),
  };
  const selectedElements = useRef(new Map<string, Element>());
  const anchors = useRef(new Map<string, import('@hachej/boring-feedback/page').AppElementAnchor>());
  const selectionRoot = page?.closest('[data-pm-layout]') ?? page;
  useEffect(() => {
    if (!open || !state.show || state.mode !== 'point' || !selectionRoot) return;
    const picker = createPicker({ root: selectionRoot, policy, styles: '.box { background: transparent; border-color: var(--border); } .label { display: none; }', tap: 'pick', wheel: false, keys: 'outside-ignored', onPick: element => {
      if (latest.current.state.chips.length >= 20) { setProblem('20 éléments maximum par message.'); return; }
      const capture = anchorOf(element, policy, { root: selectionRoot });
      if (capture.kind !== 'captured') { setProblem('Cet élément ne peut pas être joint.'); return; }
      try {
        const anchor = capture.anchor, image = captureElement(element, policy), box = element.getBoundingClientRect();
        const id = `pm-${++sequence.current}`, number = latest.current.state.nextNumber;
        const kind = feedbackLabelsFr.element(anchor.signals.role ?? element.localName, undefined);
        const label = anchor.signals.name ?? kind;
        const name = `${marker(number)} @ ${kind} · ${label} · capture jointe`;
        const controller = latest.current.spec.controller;
        controller.setAttachments([...controller.getSnapshot().draft.attachments, { id, name, content: { type: 'image', ...image } }]);
        selectedElements.current.set(id, element); anchors.current.set(id, anchor);
        const attempt = coreRef.current.current()[0];
        const at = (attempt?.offset ?? latest.current.dictated ?? 0) + (attempt?.capture.progress()?.elapsedMs ?? 0) / 1000;
        dispatch({ type: 'pick', chip: { id, kind, label, screen, at, box: [box.x, box.y, box.width, box.height] } });
        setProblem(undefined);
      } catch { setProblem('La capture de cet élément est indisponible. Réessayez.'); }
    } });
    void picker.start();
    return () => picker.dispose();
  }, [open, state.show, state.mode, policy, selectionRoot, page, screen]);
  const sequence = useRef(0);
  // Native attachment remove controls also remove the corresponding marker and pin.
  useEffect(() => {
    for (const chip of state.chips) if (!pendingBatch.current?.ids.includes(chip.id) && !snapshot.draft.attachments.some(attachment => attachment.id === chip.id) && snapshot.send.kind !== 'submitting' && snapshot.send.kind !== 'unknown' && snapshot.send.kind !== 'validating') {
      dispatch({ type: 'remove', id: chip.id }); selectedElements.current.delete(chip.id); anchors.current.delete(chip.id);
    }
  }, [snapshot.draft.attachments, snapshot.send.kind, state.chips]);
  useEffect(() => {
    if (!open || (state.mode !== 'point' && state.mode !== 'navigate') || !selectionRoot) return;
    const overlay = createOverlay({ document: selectionRoot.ownerDocument, styles: '.box { border-color: var(--border); }' });
    const elements = new Map<Element, string[]>();
    for (const chip of state.chips) {
      const element = selectedElements.current.get(chip.id);
      if (!element?.isConnected || !element.getClientRects().length) continue;
      elements.set(element, [...(elements.get(element) ?? []), marker(chip.number)]);
    }
    overlay.draw([...elements].map(([element, numbers]) => ({ element, label: numbers.join(' '), tone: 'hover' as const })));
    return () => overlay.dispose();
  }, [open, state.mode, state.chips, selectionRoot, screen]);
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
        const payload = { format: 'pm.points@1', captureBatch: `${batchPrefix}-${++batchSequence.current}`, dictatedSeconds: dictated,
          transcriptSegments: speech.segments ?? [], alignment: speech.segments?.some(segment => segment.words?.length) ? 'word' : speech.segments?.length ? 'segment' : 'unavailable',
          policy: { version: policy.version, widened: policy.widened }, selections: state.chips.map(({ id, number, kind, label, screen, at }) => ({ n: number, kind, label, screen,
            atMs: Math.round(at * 1000), screenshot: { imageIndex: snapshot.draft.attachments.findIndex(image => image.id === id), mimeType: snapshot.draft.attachments.find(image => image.id === id)?.content.mimeType }, anchor: anchors.current.get(id) })) };
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
  const liveText = recording ? alignedTranscript(live.text, live.segments, state.chips.filter(chip => !snapshot.draft.text.includes(marker(chip.number))).map(chip => ({ ...chip, at: Math.max(0, chip.at - (item?.offset ?? 0)) }))) : '';
  const remove = (id: string) => {
    const chip = state.chips.find(value => value.id === id);
    if (!chip) return;
    spec.controller.setText(spec.controller.getSnapshot().draft.text.replace(marker(chip.number), ''));
    spec.controller.setAttachments(spec.controller.getSnapshot().draft.attachments.filter(image => image.id !== id));
    dispatch({ type: 'remove', id }); selectedElements.current.delete(id); anchors.current.delete(id);
  };
  const returnToComposer = () => {
    if (recording) { finish(); return; }
    keepMarkers(spec.controller, state.chips);
    dispatch({ type: 'return' }); setFocusVersion(value => value + 1);
  };
  return { state, dispatch, voice, recording, problem, liveText, sendContext, dictated, snapshot, remove, returnToComposer, focusVersion };
}

export type PmPanelState = ReturnType<typeof usePmPanel>;
