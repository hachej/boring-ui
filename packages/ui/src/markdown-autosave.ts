import { useCallback, useEffect, useRef } from 'react';
import type { MarkdownController } from './markdown.js';
import type { SaveResult } from './resources.js';

export type MarkdownAutosave = boolean | { readonly delayMs?: number };
export type MarkdownFlush = () => Promise<boolean>;

/** Browser editing policy only. All writes still use the controller's exact conditional flush. */
export function useMarkdownAutosave(controller: MarkdownController, autosave: MarkdownAutosave, report: (result: SaveResult) => void) {
  const enabled = autosave !== false;
  const delayMs = typeof autosave === 'object' ? autosave.delayMs ?? 1200 : 1200;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const reporting = useRef(report); reporting.current = report;
  const running = useRef<Promise<boolean> | null>(null);
  const paused = useRef<ReturnType<MarkdownController['getSnapshot']>['save'] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => { clearTimeout(timer.current); timer.current = undefined; }, []);
  const flush = useCallback((manual = false): Promise<boolean> => {
    cancel();
    if (running.current) return running.current;
    const drain = async () => {
      for (;;) {
        const state = controller.getSnapshot();
        if (state.lifecycle !== 'active' || state.readOnly) return !state.dirty;
        if (state.save.kind === 'pending') {
          await new Promise<void>(resolve => {
            const stop = controller.subscribe(() => { if (controller.getSnapshot().save.kind !== 'pending' || controller.getSnapshot().lifecycle !== 'active') { stop(); resolve(); } });
          });
          continue;
        }
        if (state.save.kind === 'settled' && state.save.result.kind === 'unknown') return false;
        if (!state.dirty || !manual && state.bufferVersion === 0) return true;
        if (!manual && (paused.current || state.remote !== null)) return false;
        const result = await controller.flush(controller.actions.selection());
        reporting.current(result);
        if (result.kind !== 'saved') { paused.current = controller.getSnapshot().save; return false; }
        // A late acknowledgement only cleans its captured text. Select any newer edit after it settles.
      }
    };
    const promise = Promise.resolve().then(drain).catch(() => {
      paused.current = controller.getSnapshot().save;
      reporting.current({ kind: 'unavailable', reason: 'The save could not be completed. Your text is still available.' });
      return false;
    }).finally(() => { if (running.current === promise) running.current = null; });
    running.current = promise;
    return promise;
  }, [cancel, controller]);

  useEffect(() => {
    if (!enabled) return;
    const changed = () => {
      const state = controller.getSnapshot();
      if (paused.current && state.save !== paused.current && (state.save.kind === 'idle' || state.save.kind === 'settled' && state.save.result.kind === 'saved')) paused.current = null;
      cancel();
      if (state.lifecycle !== 'active' || state.readOnly || !state.dirty || state.bufferVersion === 0 || paused.current || state.remote !== null || state.save.kind === 'pending') return;
      if (state.save.kind === 'settled' && state.save.result.kind !== 'saved') { paused.current = state.save; return; }
      timer.current = setTimeout(() => { void flush(); }, delayMs);
    };
    const hidden = () => { if (document.visibilityState === 'hidden') void flush(); };
    const pagehide = () => { void flush(); };
    const stop = controller.subscribe(changed);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    changed();
    return () => {
      stop(); cancel();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
    };
  }, [cancel, controller, delayMs, enabled, flush]);
  useEffect(() => () => {
    const state = controller.getSnapshot();
    if (enabledRef.current && state.dirty && state.bufferVersion > 0) void flush();
  }, [controller, flush]);
  const immediate = useCallback(() => flush(), [flush]);
  const manual = useCallback(() => flush(true), [flush]);
  return { enabled, immediate, manual };
}
