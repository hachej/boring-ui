'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { voiceRefusalLabel } from './chat-text.js';
import { useVoiceAttempt } from './voice-attempt.js';

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';
export interface Dictation {
  readonly phase: DictationPhase;
  readonly seconds: number;
  readonly levels: readonly number[];
  readonly paused: boolean;
  readonly pause: (() => void) | undefined;
  readonly resume: (() => void) | undefined;
  readonly problem: string | undefined;
  readonly start: () => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}
export type DictationLabels = Readonly<Record<typeof voiceRefusalLabel[keyof typeof voiceRefusalLabel] | 'voiceNothingHeard' | 'voiceTranscribeFailed', string>>;
export interface DictationOptions {
  readonly transcribe: ((audio: Blob, signal: AbortSignal) => Promise<string>) | undefined;
  readonly onText: (text: string, signal: AbortSignal) => void | Promise<void>;
  readonly labels: DictationLabels;
  /** Capture stops at this limit; transcription still waits for finish (default five minutes). */
  readonly maxMs?: number | undefined;
  /** Changing the target drops pending permission/transcription instead of inserting into the new subject. */
  readonly target?: unknown;
}

/** Gesture-started dictation over the shared attempt lifecycle; host callbacks and labels are captured per attempt. */
export function useDictation(options: DictationOptions): Dictation {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [problem, setProblem] = useState<string>();
  const core = useVoiceAttempt<{ readonly options: DictationOptions }>({
    valid: item => latest.current.target === item.options.target,
    refused: result => setProblem(latest.current.labels[voiceRefusalLabel[result.code ?? 'failed']]),
  });
  const actions = useRef(core);
  useLayoutEffect(() => { actions.current = core; });
  const cancel = useCallback(() => { actions.current.clear(); setProblem(undefined); }, []);
  // A committed subject change releases pending microphone permission and aborts transcription.
  useLayoutEffect(() => cancel(), [options.target, cancel]);
  const start = useCallback(() => {
    const selected = latest.current;
    if (!selected.transcribe || actions.current.current().length) return;
    setProblem(undefined); actions.current.start({ options: selected }, selected.maxMs);
  }, []);
  const finish = useCallback(() => {
    const api = actions.current, item = api.current()[0];
    if (!item || !api.valid(item)) return;
    if (item.phase === 'starting') { cancel(); return; }
    if (item.phase !== 'recording') return;
    const selected = item.options;
    void (async () => {
      try {
        const recording = await api.stop(item);
        if (!api.valid(item)) return;
        if (!recording) { setProblem(selected.labels.voiceNothingHeard); return; }
        const text = (await selected.transcribe!(recording.audio, item.abort.signal)).trim();
        if (!api.valid(item)) return;
        if (!text) { setProblem(selected.labels.voiceNothingHeard); return; }
        await selected.onText(text, item.abort.signal);
      } catch { if (api.valid(item)) setProblem(selected.labels.voiceTranscribeFailed); }
      finally { if (api.valid(item)) api.remove(item); }
    })();
  }, [cancel]);
  const item = core.attempts[0];
  return { phase: item?.phase === 'processing' ? 'transcribing' : item?.phase ?? 'idle', seconds: item?.seconds ?? 0,
    levels: item?.levels ?? [], paused: item?.paused ?? false,
    pause: item?.phase === 'recording' && item.canPause ? () => core.pause(item) : undefined,
    resume: item?.phase === 'recording' && item.canPause ? () => core.resume(item) : undefined,
    problem, start, finish, cancel };
}
