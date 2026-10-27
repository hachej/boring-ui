'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createVoiceCapture, DEFAULT_MAX_VOICE_MS } from './voice-capture.js';
import type { VoiceCapture, VoiceRecording, VoiceStart } from './voice-capture.js';

export type VoiceAttempt<Data, Phase extends string = never> = Data & {
  readonly id: number;
  readonly abort: AbortController;
  readonly capture: VoiceCapture;
  readonly maxMs: number;
  phase: 'starting' | 'recording' | 'processing' | Phase;
  seconds: number;
  levels: readonly number[];
  paused: boolean;
  canPause: boolean;
};
export interface VoiceAttemptOptions<Data, Phase extends string> {
  readonly valid?: (item: VoiceAttempt<Data, Phase>) => boolean;
  readonly refused?: (result: Extract<VoiceStart, { kind: 'refused' }>) => void;
}

/** Owns only this viewer's microphone attempts, never the borrowed chat or native execution. */
export function useVoiceAttempt<Data extends object, Phase extends string = never>(options: VoiceAttemptOptions<Data, Phase> = {}) {
  type Attempt = VoiceAttempt<Data, Phase>;
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const mounted = useRef(false), owned = useRef<Attempt[]>([]), sequence = useRef(0);
  const timers = useRef(new Map<Attempt, ReturnType<typeof setInterval>>());
  const [, changed] = useState(0);
  const update = () => { if (mounted.current) changed(value => value + 1); };
  const valid = (item: Attempt) => mounted.current && owned.current.includes(item) && !item.abort.signal.aborted && (latest.current.valid?.(item) ?? true);
  const stopTimer = (item: Attempt) => { clearInterval(timers.current.get(item)); timers.current.delete(item); };
  const remove = (item: Attempt) => {
    owned.current = owned.current.filter(current => current !== item);
    stopTimer(item); item.abort.abort(); item.capture.cancel(); update();
  };
  const clear = () => { for (const item of [...owned.current]) remove(item); };
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const cancelRecording = () => {
      for (const item of [...owned.current]) if (item.phase === 'starting' || item.phase === 'recording') remove(item);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelRecording(); };
    const hidden = () => { if (document.hidden) cancelRecording(); };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', cancelRecording); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancelRecording); document.removeEventListener('visibilitychange', hidden);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers cancel only the currently owned captures, not admitted or processing work
  }, []);
  const pause = (item: Attempt) => { if (valid(item) && item.phase === 'recording' && item.capture.pause()) { item.paused = true; update(); } };
  const resume = (item: Attempt) => { if (valid(item) && item.phase === 'recording' && item.capture.resume()) { item.paused = false; update(); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- teardown releases the attempts owned at unmount, including ones created after mount
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clear(); }; }, []);
  const start = (data: Data, configuredMaxMs = DEFAULT_MAX_VOICE_MS): Attempt => {
    const maxMs = Number.isFinite(configuredMaxMs) && configuredMaxMs > 0 ? configuredMaxMs : Infinity;
    const item: Attempt = { ...data, id: ++sequence.current, maxMs, abort: new AbortController(), capture: createVoiceCapture({ maxMs }), phase: 'starting', seconds: 0, levels: [], paused: false, canPause: false };
    owned.current = [...owned.current, item]; update();
    // No await before start: microphone permission belongs to the initiating gesture.
    void item.capture.start().then(result => {
      if (!valid(item)) { remove(item); return; }
      if (result.kind === 'refused') { remove(item); latest.current.refused?.(result); return; }
      item.phase = 'recording'; update();
      let elapsedMs = 0;
      timers.current.set(item, setInterval(() => {
        if (!valid(item)) { remove(item); return; }
        const progress = item.capture.progress();
        if (!progress) return;
        item.seconds = Math.floor(progress.elapsedMs / 1000);
        item.canPause = progress.canPause; item.paused = progress.paused;
        if (progress.level !== undefined && !progress.paused && progress.elapsedMs > elapsedMs) item.levels = [...item.levels.slice(-31), progress.level];
        elapsedMs = progress.elapsedMs;
        update();
      }, 100));
    }).catch(() => {
      if (!valid(item)) { remove(item); return; }
      remove(item); latest.current.refused?.({ kind: 'refused', code: 'failed', reason: 'The microphone could not be started.' });
    });
    return item;
  };
  const stop = async (item: Attempt): Promise<VoiceRecording | null> => {
    if (!valid(item)) return null;
    if (item.phase === 'starting') { remove(item); return null; }
    if (item.phase !== 'recording') return null;
    item.phase = 'processing'; stopTimer(item); update();
    const recording = await item.capture.stop().catch(() => null);
    if (!valid(item)) return null;
    if (recording) item.seconds = Math.max(0, Math.round((recording.endedAt - recording.startedAt) / 1000));
    update(); return recording;
  };
  return { attempts: owned.current as readonly Attempt[], captureSequence: sequence.current, current: () => owned.current as readonly Attempt[], start, stop, pause, resume, remove, clear, valid, update };
}
