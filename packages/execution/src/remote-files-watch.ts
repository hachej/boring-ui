// Pi's `FileSystem.watch` over the remote-files wire: one streamed request per watcher. The worker's native watcher pushes changes
// into a bounded queue; a full queue or an oversized frame collapses into `overflow`, which Pi defines as "rescan everything watched".
import type { Context } from '@earendil-works/chord';
import { FileError, ok } from '@earendil-works/pi-durable/env';
import type { FileSystem, FileWatcher, Result, WatchChange, WatchTarget } from '@earendil-works/pi-durable/env';
import { parseWatchChange, streamFrame, streamType, wireWatchChange } from './remote-files-protocol.js';

const maxQueuedChanges = 256;
const encode = (value: object): Uint8Array => new TextEncoder().encode(JSON.stringify(value) + '\n');

export interface ServeWatch {
  readonly fs: FileSystem;
  readonly targets: readonly WatchTarget[];
  readonly binding: object;
  readonly requestId: string;
  readonly context: Context;
  readonly cleanup: Context;
  readonly maxFrameBytes: number;
  /** Re-check authorization and binding before each disclosure. */
  readonly permitted: () => Promise<boolean>;
  /** Close the watcher's lease facade; called once after the watcher has closed. */
  readonly release: () => Promise<void>;
  readonly onCleanupError?: ((error: unknown) => void) | undefined;
  readonly stop: () => void;
}

/** Start the native watcher. A failure to establish coverage is a normal result; otherwise a stream response that owns the watcher. */
export async function serveWatch(o: ServeWatch): Promise<Result<Response, FileError>> {
  const queue: WatchChange[] = [];
  let wake: (() => void) | undefined, ended = false, finished = false;
  const signal = o.context.abortSignal;
  const push = (change: WatchChange): void => {
    if (ended) return;
    if (queue.length >= maxQueuedChanges) { queue.length = 0; queue.push({ overflow: true }); }
    else queue.push(change);
    wake?.();
  };
  const opened = await o.fs.watch(o.targets, push, o.context);
  if (!opened.ok) return opened;
  const watcher: FileWatcher = opened.value;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    ended = true; wake?.();
    try { await watcher.close(o.cleanup); } finally { await o.release(); }
  })();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let sequence = 1;
  const interrupt = (): void => {
    if (finished) return;
    finished = true; signal?.removeEventListener('abort', interrupt);
    controller.error(new Error('Remote file watch interrupted'));
    void close().catch(error => o.onCleanupError?.(error));
  };
  const frameFor = (change: WatchChange): Uint8Array => {
    const frame = (value: WatchChange) => encode({ requestId: o.requestId, sequence, type: 'change', change: wireWatchChange(value) });
    const bytes = frame(change);
    return bytes.length <= o.maxFrameBytes ? bytes : frame({ overflow: true });
  };
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      controller.enqueue(encode({ ...o.binding, type: 'opened', sequence: 0, mode: watcher.mode }));
      signal?.addEventListener('abort', interrupt, { once: true });
      if (signal?.aborted) interrupt();
    },
    async pull() {
      try {
        while (!finished && queue.length === 0 && !ended) await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
        if (finished) return;
        const change = queue.shift();
        if (change === undefined) { interrupt(); return; }
        if (!await o.permitted()) { interrupt(); return; }
        controller.enqueue(frameFor(change)); sequence++;
        // Pi: after an `error` change no calls follow.
        if ('error' in change) {
          finished = true; signal?.removeEventListener('abort', interrupt);
          await close(); controller.enqueue(encode({ requestId: o.requestId, sequence: sequence++, type: 'end' })); controller.close();
        }
      } catch { interrupt(); }
    },
    async cancel() { finished = true; signal?.removeEventListener('abort', interrupt); o.stop(); await close(); },
  }, { highWaterMark: 1 });
  return ok(new Response(body, { headers: { 'content-type': streamType, 'cache-control': 'no-store' } }));
}

/** Client side: consume an `opened` + `change` stream into Pi's `FileWatcher`. `deliver` is never called after `close` resolves. */
export function watcherFromFrames(options: {
  readonly mode: 'native' | 'polling';
  readonly next: () => Promise<unknown>;
  readonly requestId: string;
  readonly onChange: (change: WatchChange) => void;
  readonly dispose: () => Promise<void>;
}): FileWatcher {
  let stopped = false;
  const deliver = (change: WatchChange): void => { if (!stopped) { try { options.onChange(change); } catch { /* a throwing listener must not stop the watcher */ } } };
  void (async () => {
    let sequence = 1;
    try {
      while (!stopped) {
        const raw = await options.next();
        if (stopped) return;
        if (raw === undefined) throw new TypeError('Watch stream ended without a terminal frame');
        const frame = streamFrame.parse(raw);
        if (frame.requestId !== options.requestId || frame.sequence !== sequence++ || frame.type === 'opened') throw new TypeError('Watch frame sequence mismatch');
        if (frame.type === 'end') { stopped = true; await options.dispose(); return; }
        if (frame.type !== 'change') throw new TypeError('Unexpected watch frame');
        const change = parseWatchChange(frame.change);
        deliver(change);
        if ('error' in change) { stopped = true; await options.dispose(); return; }
      }
    } catch {
      if (stopped) return;
      deliver({ error: new FileError('unknown', 'Remote file watch was interrupted') });
      stopped = true; await options.dispose();
    }
  })();
  return { mode: options.mode, close: async () => { stopped = true; await options.dispose(); } };
}
