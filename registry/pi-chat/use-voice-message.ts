'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createVoiceCapture, DEFAULT_MAX_VOICE_MS } from '@hachej/boring-ui-kit/voice-capture';
import type { VoiceCapture, VoiceRecording, VoiceRefusal } from '@hachej/boring-ui-kit/voice-capture';
import type { ChatController, ChatDraft } from '@hachej/boring-ui-kit/native-chat';
import { isVoicePath, mentionToken } from './config';
import type { AttachmentsConfig, VoiceMessageConfig } from './config';
import type { ChatLabels } from './labels';

type Phase = 'starting' | 'recording' | 'processing' | 'transcribe-failed' | 'upload-failed' | 'sending' | 'unconfirmed' | 'blocked';
interface Attempt {
  readonly id: number;
  readonly controller: ChatController;
  readonly target: string;
  readonly transcribe: VoiceMessageConfig['transcribe'];
  readonly upload: AttachmentsConfig['upload'] | undefined;
  readonly abort: AbortController;
  readonly capture: VoiceCapture;
  readonly maxMs: number;
  phase: Phase;
  seconds: number;
  file?: File;
  path?: string;
  transcript?: string;
  requestId?: string;
}
export interface PendingVoice {
  readonly id: number;
  readonly path: string | undefined;
  readonly phase: Phase;
  readonly seconds: number;
  readonly retry: () => void;
  readonly audioOnly: (() => void) | undefined;
  readonly discard: () => void;
}
const REFUSAL: Readonly<Record<VoiceRefusal, keyof Pick<ChatLabels, 'voiceDenied' | 'voiceNoMicrophone' | 'voiceBusy' | 'voiceInsecure' | 'voiceUnsupported' | 'voiceStartFailed'>>> = {
  denied: 'voiceDenied', 'no-microphone': 'voiceNoMicrophone', busy: 'voiceBusy', insecure: 'voiceInsecure', unsupported: 'voiceUnsupported', failed: 'voiceStartFailed',
};
const targetOf = (controller: ChatController) => {
  const { identity, conversationId } = controller.getSnapshot();
  return JSON.stringify([identity.runtimeId, identity.scopeId, identity.principalId, conversationId]);
};
const noSubscribe = () => () => {};

/** Local admission preparation only. Native send/reconcile owns the submission; uploaded bytes stay in the host workspace. */
export function useVoiceMessage({ controller, config, attachments, labels, admitted, activeController }: {
  readonly controller: ChatController | undefined;
  readonly config: VoiceMessageConfig | undefined;
  readonly attachments?: AttachmentsConfig | undefined;
  readonly labels: ChatLabels;
  readonly admitted?: (() => void) | undefined;
  readonly activeController?: { readonly current: ChatController } | undefined;
}) {
  const selected = config ? controller : undefined;
  const readObservation = useCallback(() => {
    if (!selected) return '';
    const snapshot = selected.getSnapshot(), send = snapshot.send;
    return JSON.stringify([targetOf(selected), snapshot.disposed, send.kind, 'attempt' in send ? send.attempt.requestId : undefined]);
  }, [selected]);
  const observation = useSyncExternalStore(selected?.subscribe ?? noSubscribe, readObservation, readObservation);
  const latest = useRef({ controller, config, admitted, activeController }); latest.current = { controller, config, admitted, activeController };
  const mounted = useRef(false), attempts = useRef<Attempt[]>([]), captureSequence = useRef(0);
  const [, changed] = useState(0), [problem, setProblem] = useState<string>();
  const update = () => changed(value => value + 1);
  const valid = (item: Attempt) => mounted.current && attempts.current.includes(item) && latest.current.controller === item.controller && (!latest.current.activeController || latest.current.activeController.current === item.controller) && Boolean(latest.current.config) && !item.abort.signal.aborted && !item.controller.getSnapshot().disposed && targetOf(item.controller) === item.target;
  const remove = (item: Attempt) => {
    attempts.current = attempts.current.filter(current => current !== item);
    item.abort.abort(); item.capture.cancel();
    if (mounted.current) update();
  };
  const active = () => attempts.current.find(item => item.phase === 'starting' || item.phase === 'recording') ?? attempts.current.find(item => item.phase === 'processing' || item.phase === 'sending' || item.phase === 'unconfirmed');
  const cancel = () => { const item = active(); if (item) remove(item); };
  const clear = () => { for (const item of [...attempts.current]) remove(item); };
  const target = selected ? targetOf(selected) : undefined;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clear(); }; }, []);
  useEffect(() => { clear(); setProblem(undefined); }, [controller, target, Boolean(config)]);
  useEffect(() => {
    for (const item of [...attempts.current]) {
      if (!valid(item)) { remove(item); continue; }
      if (item.phase !== 'unconfirmed') continue;
      const snapshot = selected?.getSnapshot();
      if (snapshot?.send.kind === 'admitted' && 'attempt' in snapshot.send && snapshot.send.attempt.requestId === item.requestId) {
        remove(item); latest.current.admitted?.();
      } else if (snapshot?.send.kind === 'blocked') { item.phase = 'blocked'; update(); }
    }
  }, [selected, observation]);
  const recording = active(), phase = recording?.phase ?? 'idle';
  useEffect(() => {
    const item = recording;
    if (item?.phase !== 'recording') return;
    const started = performance.now();
    const timer = setInterval(() => { if (valid(item)) { item.seconds = Math.floor(Math.min(performance.now() - started, item.maxMs) / 1000); update(); } }, 250);
    return () => clearInterval(timer);
  }, [recording, phase]);

  const send = async (item: Attempt, audioOnly = false) => {
    if (!valid(item) || !item.path || item.phase === 'sending' || item.phase === 'unconfirmed') return;
    const transcript = audioOnly ? '' : item.transcript ?? '';
    const text = `${mentionToken(item.path)}${transcript ? ` ${transcript}` : ''}`;
    const before = item.controller.getSnapshot();
    if (before.send.kind === 'unknown') {
      // This recording was never submitted. Do not bind it to another message's uncertain request.
      const draft = item.controller.getSnapshot().draft.text;
      if (transcript) item.controller.setText(`${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${transcript}`);
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
    } catch { if (!valid(item)) return; }
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
    item.phase = 'processing'; update();
    void (async () => {
      const recording: VoiceRecording | null = await item.capture.stop().catch(() => null);
      if (!valid(item)) return;
      if (!recording) { remove(item); setProblem(labels.voiceNothingHeard); update(); return; }
      item.seconds = Math.max(0, Math.round((recording.endedAt - recording.startedAt) / 1000));
      const type = recording.mimeType.split(';')[0]!, ext = type === 'audio/mp4' ? 'mp4' : type === 'audio/ogg' ? 'ogg' : 'webm';
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d+)Z$/, '-$1');
      item.file = new File([recording.audio], `voice-${stamp}.${ext}`, { type });
      await process(item);
    })();
  };
  const start = () => {
    if (!controller || !config || active() || controller.getSnapshot().disposed || controller.getSnapshot().send.kind === 'unknown') return;
    captureSequence.current += 1; setProblem(undefined);
    const maxMs = config.maxMs ?? DEFAULT_MAX_VOICE_MS;
    const item: Attempt = { id: captureSequence.current, maxMs: Number.isFinite(maxMs) && maxMs > 0 ? maxMs : Infinity, controller, transcribe: config.transcribe.bind(config), upload: config.upload?.bind(config) ?? attachments?.upload.bind(attachments), target: targetOf(controller), abort: new AbortController(), capture: createVoiceCapture({ ...(config.maxMs !== undefined ? { maxMs: config.maxMs } : {}) }), phase: 'starting', seconds: 0 };
    attempts.current = [...attempts.current, item]; update();
    void item.capture.start().then(result => {
      if (!valid(item)) { item.capture.cancel(); return; }
      if (result.kind === 'refused') { remove(item); setProblem(result.code ? labels[REFUSAL[result.code]] : result.reason); update(); return; }
      item.phase = 'recording'; update();
    });
  };
  const item = active();
  const pending: readonly PendingVoice[] = attempts.current.filter(item => item.phase !== 'starting' && item.phase !== 'recording').map(item => ({
    id: item.id, path: item.path, phase: item.phase, seconds: item.seconds,
    retry: () => { if (item.phase === 'upload-failed' || item.phase === 'transcribe-failed') void process(item); },
    audioOnly: item.phase === 'transcribe-failed' && item.path ? () => { if (item.phase === 'transcribe-failed') void send(item, true); } : undefined,
    discard: () => { if (valid(item)) remove(item); },
  }));
  return { canStart: Boolean(controller && config && !item && !controller.getSnapshot().disposed && controller.getSnapshot().send.kind !== 'unknown'), phase: item?.phase ?? 'idle', seconds: item?.seconds ?? 0, captureSequence: captureSequence.current, problem, pending, start, finish, cancel };
}
