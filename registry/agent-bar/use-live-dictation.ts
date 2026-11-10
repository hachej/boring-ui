'use client';

// D-1978 part 4: live dictation for the agent bar. The app owns the stream (a provider socket, a browser recognizer, a fake in a test); the kit owns what the
// bar shows. The stream reports not-yet-final words with `partial` (each call replaces the last) and finished words with `final` (each call appends); `stop`
// resolves once the provider has flushed its last final words. What is sent is the final words only. Same shape as the kit's `useDictation`, plus `final` and `interim`.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DictationPhase } from '@hachej/boring-ui-kit/chat-react/voice';

export interface LiveSink {
  /** The words heard so far that may still change; replaces the previous partial. */
  readonly partial: (text: string) => void;
  /** Words that will not change; appended, and the partial is cleared. */
  readonly final: (text: string) => void;
  /** Optional input level in 0..1 for the waveform. */
  readonly level?: (value: number) => void;
  /** The stream died (refused microphone, socket closed): the attempt ends with this problem, or the start-failed label. */
  readonly fail: (problem?: string) => void;
}
export interface LiveSession {
  /** Ends the capture; resolves after the last final words were delivered through the sink. */
  readonly stop: () => Promise<void> | void;
  /** Drops the capture without waiting for anything. */
  readonly cancel: () => void;
}
/** Opens one live capture. `signal` aborts when the attempt is cancelled before the session resolves. */
export type LiveStream = (sink: LiveSink, signal: AbortSignal) => Promise<LiveSession>;

export interface LiveDictationOptions {
  readonly stream: LiveStream | undefined;
  readonly onText: (text: string) => void;
  readonly labels: { readonly voiceNothingHeard: string; readonly voiceStartFailed: string; readonly voiceTranscribeFailed: string };
}
export interface LiveDictation {
  readonly phase: DictationPhase;
  readonly levels: readonly number[];
  readonly problem: string | undefined;
  /** The final words so far and the dimmed tail that is not final yet. */
  readonly final: string;
  readonly interim: string;
  readonly start: () => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}

interface Attempt { readonly abort: AbortController; session?: LiveSession; readonly finals: string[] }
const LEVELS = 40;

export function useLiveDictation(options: LiveDictationOptions): LiveDictation {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const current = useRef<Attempt | undefined>(undefined);
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [final, setFinal] = useState('');
  const [interim, setInterim] = useState('');
  const [levels, setLevels] = useState<readonly number[]>([]);
  const [problem, setProblem] = useState<string>();

  const reset = useCallback(() => { current.current = undefined; setPhase('idle'); setFinal(''); setInterim(''); setLevels([]); }, []);
  const drop = useCallback((attempt: Attempt) => { attempt.abort.abort(); try { attempt.session?.cancel(); } catch { /* already gone */ } }, []);
  const cancel = useCallback(() => {
    const attempt = current.current;
    if (attempt) drop(attempt);
    reset(); setProblem(undefined);
  }, [drop, reset]);
  useEffect(() => () => { const attempt = current.current; if (attempt) drop(attempt); current.current = undefined; }, [drop]);

  const start = useCallback(() => {
    const open = latest.current.stream;
    if (!open || current.current) return;
    const attempt: Attempt = { abort: new AbortController(), finals: [] };
    current.current = attempt;
    setProblem(undefined); setFinal(''); setInterim(''); setLevels([]); setPhase('starting');
    const live = () => current.current === attempt && !attempt.abort.signal.aborted;
    const fail = (message?: string) => {
      if (!live()) return;
      drop(attempt); reset(); setProblem(message ?? latest.current.labels.voiceStartFailed);
    };
    const sink: LiveSink = {
      partial: text => { if (live()) setInterim(text.trim()); },
      final: text => { if (!live()) return; const clean = text.trim(); if (clean) { attempt.finals.push(clean); setFinal(attempt.finals.join(' ')); } setInterim(''); },
      level: value => { if (live()) setLevels(previous => [...previous.slice(-(LEVELS - 1)), Math.max(0, Math.min(1, value))]); },
      fail,
    };
    open(sink, attempt.abort.signal).then(session => {
      if (!live()) { try { session.cancel(); } catch { /* already gone */ } return; }
      attempt.session = session; setPhase('recording');
    }, () => fail());
  }, [drop, reset]);

  const finish = useCallback(() => {
    const attempt = current.current;
    if (!attempt) return;
    if (!attempt.session) { cancel(); return; }
    const session = attempt.session;
    setPhase('transcribing');
    void (async () => {
      try {
        await session.stop();
        if (current.current !== attempt || attempt.abort.signal.aborted) return;
        const text = attempt.finals.join(' ').trim();
        if (!text) { setProblem(latest.current.labels.voiceNothingHeard); return; }
        latest.current.onText(text);
      } catch { if (current.current === attempt) setProblem(latest.current.labels.voiceTranscribeFailed); }
      finally { if (current.current === attempt) reset(); }
    })();
  }, [cancel, reset]);

  return { phase, levels, problem, final, interim, start, finish, cancel };
}
