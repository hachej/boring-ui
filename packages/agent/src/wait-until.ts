import type { TaskRuntime } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';

/**
 * Wait inside the running phase until the Harness clock reaches `at`, on the Harness's own timer (`TaskRuntime.setTimer`, the
 * 1.4 replacement for the removed `TaskRuntime.sleep`). It rejects when `context` is cancelled first. `disarm` frees the timer
 * when something else ends the wait. It is not durable: a restart reruns the phase, which reads its absolute deadline again.
 */
export function waitUntil(runtime: Pick<TaskRuntime<never, never, never, never>, 'now' | 'setTimer'>, at: number, context: Context): { readonly done: Promise<void>; readonly disarm: () => void } {
  let disarm = (): void => {};
  const done = new Promise<void>((resolve, reject) => {
    const signal = context.abortSignal;
    if (signal?.aborted) { reject(signal.reason ?? new Error('Wait cancelled')); return; }
    const onAbort = (): void => { disarm(); reject(signal!.reason ?? new Error('Wait cancelled')); };
    const disarmTimer = runtime.setTimer(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, at - runtime.now()));
    signal?.addEventListener('abort', onAbort, { once: true });
    disarm = () => { signal?.removeEventListener('abort', onAbort); disarmTimer(); };
  });
  return { done, disarm: () => disarm() };
}
