'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createVoiceCapture } from '@hachej/boring-ui-kit/voice-capture';
import type { VoiceCapture, VoiceRefusal } from '@hachej/boring-ui-kit/voice-capture';
import { useRecordingCancellation } from '../pi-chat-voice/use-hold-to-record';
import { chatTextFor } from '../pi-chat/locale';
import type { ChatLocale } from '../pi-chat/locale';

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
export type DictationLabels = Pick<ReturnType<typeof chatTextFor>['labels'],
  'voiceDenied' | 'voiceNoMicrophone' | 'voiceBusy' | 'voiceInsecure' | 'voiceUnsupported' | 'voiceStartFailed' | 'voiceNothingHeard' | 'voiceTranscribeFailed'>;
export interface DictationOptions {
  readonly transcribe: ((audio: Blob, signal: AbortSignal) => Promise<string>) | undefined;
  readonly onText: (text: string, signal: AbortSignal) => void | Promise<void>;
  readonly locale?: ChatLocale | undefined;
  readonly labels?: Partial<DictationLabels> | undefined;
}

const REFUSAL: Readonly<Record<VoiceRefusal, 'voiceDenied' | 'voiceNoMicrophone' | 'voiceBusy' | 'voiceInsecure' | 'voiceUnsupported' | 'voiceStartFailed'>> = {
  denied: 'voiceDenied', 'no-microphone': 'voiceNoMicrophone', busy: 'voiceBusy', insecure: 'voiceInsecure', unsupported: 'voiceUnsupported', failed: 'voiceStartFailed',
};

/** Gesture-started dictation. Each attempt captures its callbacks; cancellation fences late permission, transcription and text delivery. */
export function useDictation(options: DictationOptions): Dictation {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>([]);
  const [paused, setPaused] = useState(false), [canPause, setCanPause] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const phaseRef = useRef<DictationPhase>('idle');
  const current = useRef<{ readonly capture: VoiceCapture; readonly abort: AbortController; readonly options: DictationOptions } | null>(null);
  const set = (next: DictationPhase) => { phaseRef.current = next; setPhase(next); };

  useEffect(() => () => { current.current?.abort.abort(); current.current?.capture.cancel(); current.current = null; }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      const progress = current.current?.capture.progress();
      if (!progress) return;
      setSeconds(Math.floor(progress.elapsedMs / 1000)); setCanPause(progress.canPause); setPaused(progress.paused);
      if (progress.level !== undefined && !progress.paused) setLevels(values => [...values.slice(-31), progress.level!]);
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  const cancel = useCallback(() => {
    const old = current.current;
    current.current = null;
    old?.abort.abort();
    old?.capture.cancel();
    setProblem(undefined);
    set('idle');
  }, []);
  useRecordingCancellation(() => { if (phaseRef.current === 'starting' || phaseRef.current === 'recording') cancel(); });
  const start = useCallback(() => {
    const selected = latest.current;
    if (!selected.transcribe || phaseRef.current !== 'idle') return;
    const attempt = { capture: createVoiceCapture(), abort: new AbortController(), options: selected };
    current.current = attempt;
    setSeconds(0); setLevels([]); setPaused(false); setCanPause(false);
    setProblem(undefined);
    set('starting');
    // No await before start: permission belongs to this gesture. A fresh capture cannot cancel a later attempt when permission arrives late.
    void attempt.capture.start().then(result => {
      if (current.current !== attempt) { attempt.capture.cancel(); return; }
      if (result.kind === 'refused') {
        current.current = null;
        set('idle');
        const words = { ...chatTextFor(selected.locale).labels, ...selected.labels };
        setProblem(words[result.code ? REFUSAL[result.code] : 'voiceStartFailed']);
        return;
      }
      set('recording');
    }).catch(() => {
      if (current.current !== attempt) return;
      current.current = null;
      attempt.capture.cancel();
      set('idle');
      setProblem(selected.labels?.voiceStartFailed ?? chatTextFor(selected.locale).labels.voiceStartFailed);
    });
  }, []);
  const finish = useCallback(() => {
    if (phaseRef.current === 'starting') { cancel(); return; }
    const attempt = current.current;
    if (!attempt || phaseRef.current !== 'recording') return;
    const selected = attempt.options;
    const words = { ...chatTextFor(selected.locale).labels, ...selected.labels };
    set('transcribing');
    void (async () => {
      try {
        const recording = await attempt.capture.stop();
        if (current.current !== attempt) return;
        if (!recording) { setProblem(words.voiceNothingHeard); return; }
        const text = (await selected.transcribe!(recording.audio, attempt.abort.signal)).trim();
        if (current.current !== attempt) return;
        if (!text) { setProblem(words.voiceNothingHeard); return; }
        await selected.onText(text, attempt.abort.signal);
      } catch { if (current.current === attempt) setProblem(words.voiceTranscribeFailed); }
      finally { if (current.current === attempt) { current.current = null; set('idle'); } }
    })();
  }, [cancel]);
  const pause = useCallback(() => { if (current.current?.capture.pause()) setPaused(true); }, []);
  const resume = useCallback(() => { if (current.current?.capture.resume()) setPaused(false); }, []);
  return useMemo(() => ({ phase, seconds, levels, paused, pause: phase === 'recording' && canPause ? pause : undefined, resume: phase === 'recording' && canPause ? resume : undefined, problem, start, finish, cancel }), [phase, seconds, levels, paused, canPause, pause, resume, problem, start, finish, cancel]);
}
