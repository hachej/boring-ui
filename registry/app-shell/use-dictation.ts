'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createVoiceCapture } from '@hachej/boring-ui-kit/voice-capture';
import type { VoiceCapture, VoiceRefusal } from '@hachej/boring-ui-kit/voice-capture';
import { chatTextFor } from '../pi-chat/locale';
import type { ChatLocale } from '../pi-chat/locale';

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';
export interface Dictation {
  readonly phase: DictationPhase;
  readonly seconds: number;
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
  const [problem, setProblem] = useState<string | undefined>();
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const phaseRef = useRef<DictationPhase>('idle');
  const current = useRef<{ readonly capture: VoiceCapture; readonly abort: AbortController; readonly options: DictationOptions } | null>(null);
  const set = (next: DictationPhase) => { phaseRef.current = next; setPhase(next); };

  useEffect(() => () => { current.current?.abort.abort(); current.current?.capture.cancel(); current.current = null; }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
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
  const start = useCallback(() => {
    const selected = latest.current;
    if (!selected.transcribe || phaseRef.current !== 'idle') return;
    const attempt = { capture: createVoiceCapture(), abort: new AbortController(), options: selected };
    current.current = attempt;
    setSeconds(0);
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
  return useMemo(() => ({ phase, seconds, problem, start, finish, cancel }), [phase, seconds, problem, start, finish, cancel]);
}
