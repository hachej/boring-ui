'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatController, ChatDraft } from './native-chat.js';
import { appendToDraft, isVoicePath, mentionedPaths, mentionToken, voiceRefusalLabel, withoutMentions } from './chat-text.js';
import { useVoiceAttempt } from './voice-attempt.js';
import type { VoiceAttempt } from './voice-attempt.js';
import { useDictation } from './chat-dictation.js';
import type { Dictation, DictationLabels } from './chat-dictation.js';

export type VoicePhase = 'starting' | 'recording' | 'processing' | 'transcribe-failed' | 'upload-failed' | 'sending' | 'unconfirmed' | 'blocked';
export interface PendingVoice {
  readonly id: number;
  readonly path: string | undefined;
  readonly phase: VoicePhase;
  readonly seconds: number;
  readonly retry: () => void;
  readonly audioOnly: (() => void) | undefined;
  readonly discard: () => void;
}
export interface VoiceMessageHandle {
  readonly canStart: boolean;
  readonly phase: VoicePhase | 'idle';
  readonly seconds: number;
  readonly captureSequence: number;
  readonly levels?: readonly number[];
  readonly paused?: boolean;
  readonly pause?: (() => void) | undefined;
  readonly resume?: (() => void) | undefined;
  readonly problem: string | undefined;
  readonly pending: readonly PendingVoice[];
  readonly start: () => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}
export interface VoiceMessageConfig {
  readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
  readonly maxMs?: number;
  readonly upload?: (files: File[], signal: AbortSignal) => Promise<readonly { readonly path?: string }[]>;
}
export interface VoiceRecorderOptions {
  readonly controller: ChatController | undefined;
  readonly config: VoiceMessageConfig | undefined;
  readonly attachments?: { readonly upload: NonNullable<VoiceMessageConfig['upload']> } | undefined;
  readonly labels: DictationLabels;
  readonly admitted?: (() => void) | undefined;
  readonly activeController?: { readonly current: ChatController } | undefined;
}
interface AttemptData {
  readonly controller: ChatController;
  readonly target: string;
  readonly transcribe: VoiceMessageConfig['transcribe'];
  readonly upload: VoiceMessageConfig['upload'];
  mentions: readonly string[];
  file?: File;
  path?: string;
  transcript?: string;
  requestId?: string;
}
type Attempt = VoiceAttempt<AttemptData, VoicePhase>;
const targetOf = (controller: ChatController) => {
  const { identity, conversationId } = controller.getSnapshot();
  return JSON.stringify([identity.runtimeId, identity.scopeId, identity.principalId, conversationId]);
};
const noSubscribe = () => () => {};

/** Local admission preparation only. Native send/reconcile owns the submission; uploaded bytes stay in the host workspace. */
export function useVoiceMessage({ controller, config, attachments, labels, admitted, activeController }: VoiceRecorderOptions): VoiceMessageHandle {
  const selected = config ? controller : undefined;
  const readObservation = useCallback(() => {
    if (!selected) return '';
    const snapshot = selected.getSnapshot(), send = snapshot.send;
    return JSON.stringify([targetOf(selected), snapshot.disposed, send.kind, 'attempt' in send ? send.attempt.requestId : undefined]);
  }, [selected]);
  const observation = useSyncExternalStore(selected?.subscribe ?? noSubscribe, readObservation, readObservation);
  const latest = useRef({ controller, config, admitted, activeController });
  useLayoutEffect(() => { latest.current = { controller, config, admitted, activeController }; });
  const [problem, setProblem] = useState<string>();
  const core = useVoiceAttempt<AttemptData, VoicePhase>({
    valid: item => latest.current.controller === item.controller && (!latest.current.activeController || latest.current.activeController.current === item.controller) && Boolean(latest.current.config) && !item.controller.getSnapshot().disposed && targetOf(item.controller) === item.target,
    refused: result => setProblem(labels[voiceRefusalLabel[result.code ?? 'failed']]),
  });
  const { valid, remove, clear, update } = core;
  const active = () => core.current().find(item => item.phase === 'starting' || item.phase === 'recording') ?? core.current().find(item => item.phase === 'processing' || item.phase === 'sending' || item.phase === 'unconfirmed');
  const cancel = () => { const item = active(); if (item) remove(item); };
  const target = selected ? targetOf(selected) : undefined;
  const configured = Boolean(config);
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- another controller, conversation or config drops the attempts and the problem, once per change
  useEffect(() => { clear(); setProblem(undefined); }, [controller, target, configured]);
  useEffect(() => {
    for (const item of [...core.current()]) {
      if (!valid(item)) { remove(item); continue; }
      if (item.phase !== 'unconfirmed') continue;
      const snapshot = selected?.getSnapshot();
      if (snapshot?.send.kind === 'admitted' && 'attempt' in snapshot.send && snapshot.send.attempt.requestId === item.requestId) {
        remove(item); latest.current.admitted?.();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the chat's send state settles an unconfirmed attempt; update() republishes the attempt ref
      } else if (snapshot?.send.kind === 'blocked') { item.phase = 'blocked'; update(); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the chat's observation changes; remove/update are per-render closures over refs
  }, [selected, observation]);
  const send = async (item: Attempt, audioOnly = false) => {
    if (!valid(item) || !item.path || item.phase === 'sending' || item.phase === 'unconfirmed') return;
    const transcript = audioOnly ? '' : item.transcript ?? '';
    const text = [...item.mentions.map(mentionToken), mentionToken(item.path), transcript].filter(Boolean).join(' ');
    const before = item.controller.getSnapshot();
    if (before.send.kind === 'unknown') {
      // This recording was never submitted. Do not bind it to another message's uncertain request.
      const draft = item.controller.getSnapshot().draft.text;
      if (transcript) item.controller.setText(appendToDraft(draft, transcript));
      item.phase = 'blocked'; update(); return;
    }
    item.phase = 'sending'; update();
    let submittedDraft: ChatDraft | undefined;
    try {
      const pending = item.controller.send('followUp', { text, restore: { text: transcript } });
      const after = item.controller.getSnapshot();
      // Native send synchronously publishes this immutable draft in validation or at its outbox position; equal text is not identity.
      submittedDraft = after.send.kind === 'validating' && (before.send.kind !== 'validating' || after.send.draft !== before.send.draft)
        ? after.send.draft : after.outbox[before.outbox.length];
      const result = await pending;
      if (!valid(item)) return;
      if (result) { remove(item); latest.current.admitted?.(); return; }
    } catch {
      if (!valid(item)) return;
      const draft = item.controller.getSnapshot().draft.text;
      if (transcript) item.controller.setText(appendToDraft(draft, transcript));
    }
    const native = item.controller.getSnapshot().send;
    if (native.kind === 'admitted' && 'attempt' in native && submittedDraft !== undefined && native.attempt.draft === submittedDraft) {
      remove(item); latest.current.admitted?.(); return;
    }
    const ownUnknown = native.kind === 'unknown' && 'attempt' in native && submittedDraft !== undefined && native.attempt.draft === submittedDraft;
    item.phase = native.kind === 'blocked' || (native.kind === 'unknown' && 'attempt' in native && !ownUnknown) ? 'blocked' : 'unconfirmed';
    if (ownUnknown) item.requestId = native.attempt.requestId;
    update();
  };
  const process = async (item: Attempt) => {
    if (!valid(item) || !item.file) return;
    item.phase = 'processing'; update();
    // Cache each successful half independently: retrying transcription must not upload the same recording again.
    await Promise.all([
      item.path ? undefined : (async () => {
        try {
          const results = await item.upload?.([item.file!], item.abort.signal);
          const path = results?.length === 1 ? results[0]?.path : undefined;
          if (valid(item) && path && isVoicePath(path)) item.path = path;
        } catch { /* Failed uploads remain pending for explicit retry. */ }
      })(),
      item.transcript !== undefined ? undefined : (async () => {
        try { const text = (await item.transcribe(item.file!, item.abort.signal)).trim(); if (valid(item) && text) item.transcript = text; }
        catch { /* Never send automatically when transcription fails. */ }
      })(),
    ]);
    if (!valid(item)) return;
    if (!item.path) { item.phase = 'upload-failed'; update(); }
    else if (!item.transcript) { item.phase = 'transcribe-failed'; update(); }
    else await send(item);
  };
  const finish = () => {
    const item = active();
    if (!item || !valid(item)) return;
    if (item.phase === 'starting') { cancel(); return; }
    if (item.phase !== 'recording') return;
    const draft = item.controller.getSnapshot().draft.text;
    item.mentions = mentionedPaths(draft);
    item.controller.setText(withoutMentions(draft));
    void (async () => {
      const recording = await core.stop(item);
      if (!valid(item)) return;
      if (!recording) { remove(item); setProblem(labels.voiceNothingHeard); update(); return; }
      const type = recording.mimeType.split(';')[0]!, ext = type === 'audio/wav' ? 'wav' : type === 'audio/mp4' ? 'mp4' : type === 'audio/ogg' ? 'ogg' : 'webm';
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d+)Z$/, '-$1');
      item.file = new File([recording.audio], `voice-${stamp}.${ext}`, { type });
      await process(item);
    })();
  };
  const start = () => {
    if (!controller || !config || active() || controller.getSnapshot().disposed || controller.getSnapshot().send.kind === 'unknown') return;
    setProblem(undefined);
    core.start({ controller, mentions: [], transcribe: config.transcribe.bind(config), upload: config.upload?.bind(config) ?? attachments?.upload.bind(attachments), target: targetOf(controller) }, config.maxMs);
  };
  // eslint-disable-next-line react-hooks/refs -- the attempts live in a ref that every change pairs with update(); render reads the list as of that update
  const item = active();
  // eslint-disable-next-line react-hooks/refs -- the attempts live in a ref that every change pairs with update(); render reads the list as of that update
  const pending: readonly PendingVoice[] = core.attempts.filter(item => item.phase !== 'starting' && item.phase !== 'recording').map(item => ({
    id: item.id, path: item.path, phase: item.phase, seconds: item.seconds,
    retry: () => { if (item.phase === 'upload-failed' || item.phase === 'transcribe-failed') void process(item); },
    audioOnly: item.phase === 'transcribe-failed' && item.path ? () => { if (item.phase === 'transcribe-failed') void send(item, true); } : undefined,
    discard: () => { if (valid(item)) remove(item); },
  }));
  // eslint-disable-next-line react-hooks/refs -- the capture sequence is a ref bumped with update(); render reads it as of that update
  return { canStart: Boolean(controller && config && !item && !controller.getSnapshot().disposed && controller.getSnapshot().send.kind !== 'unknown'), phase: item?.phase ?? 'idle', seconds: item?.seconds ?? 0, levels: item?.levels ?? [], paused: item?.paused ?? false,
    pause: item?.phase === 'recording' && item.canPause ? () => core.pause(item) : undefined,
    resume: item?.phase === 'recording' && item.canPause ? () => core.resume(item) : undefined,
    captureSequence: core.captureSequence, problem, pending, start, finish, cancel };
}

export interface ChatVoiceOptions {
  readonly controller: ChatController | undefined;
  readonly voice: (VoiceMessageConfig & { readonly send?: 'auto' | 'draft' | 'message' }) | undefined;
  readonly attachments?: VoiceRecorderOptions['attachments'];
  readonly labels: DictationLabels;
  readonly onDone: (outcome: 'sent' | 'drafted') => void;
}
export interface ChatVoiceHandle extends Dictation {
  readonly pending?: readonly PendingVoice[];
  readonly captureSequence?: number;
  readonly canStart?: boolean;
}

/** Selects retained voice messages or text-only dictation without putting send/draft policy in copied shells. */
export function useChatVoice({ controller, voice, attachments, labels, onDone }: ChatVoiceOptions): ChatVoiceHandle {
  const message = useVoiceMessage({ controller, config: voice?.send === 'message' ? voice : undefined, attachments, labels, admitted: () => onDone('sent') });
  const dictation = useDictation({
    transcribe: voice?.send === 'message' ? undefined : voice?.transcribe, labels, maxMs: voice?.maxMs, target: controller,
    onText: async (spoken, signal) => {
      if (!controller || signal.aborted) return;
      const fill = () => {
        if (signal.aborted) return;
        controller.setText(appendToDraft(controller.getSnapshot().draft.text, spoken)); onDone('drafted');
      };
      if (voice?.send !== 'auto') { fill(); return; }
      const draft = controller.getSnapshot().draft.text;
      const paths = mentionedPaths(draft);
      controller.setText(withoutMentions(draft));
      try {
        const sent = await controller.send(undefined, { text: [...paths.map(mentionToken), spoken].join(' '), restore: { text: spoken } });
        if (!signal.aborted) onDone(sent ? 'sent' : 'drafted');
      } catch { fill(); }
    },
  });
  const { cancel } = dictation, send = voice?.send, configured = Boolean(voice);
  useEffect(() => () => cancel(), [controller, send, configured, cancel]);
  const phase: Dictation['phase'] = message.phase === 'starting' || message.phase === 'recording' ? message.phase : message.phase === 'processing' || message.phase === 'sending' ? 'transcribing' : 'idle';
  return send === 'message' ? { ...message, phase, levels: message.levels ?? [], paused: message.paused ?? false, pause: message.pause, resume: message.resume } : dictation;
}
