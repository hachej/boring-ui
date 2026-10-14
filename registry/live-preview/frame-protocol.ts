// The messages between the app and the sandboxed preview frame (preview-frame.html). The frame has an opaque origin: its `event.origin` is
// "null", so each side trusts a message by its `source` window (the app: its own iframe; the frame: its parent), never by origin alone.
export const FRAME_TAG = 'boring.preview';
/** In a props snapshot a function becomes `{ [INTENT_KEY]: name }`; the frame turns it into a stub that reports the call and runs nothing. */
export const INTENT_KEY = '__boringIntent';

/** App to frame: compile `source` and render it with `props` (a snapshot, see snapshot.ts), styled by `css` (the app's own stylesheets). */
export interface RenderMessage { readonly boring: typeof FRAME_TAG; readonly type: 'render'; readonly source: string; readonly props: unknown; readonly css: string; readonly dark: boolean }
/** Frame to app. `intent` is a component callback that was called: shown, never executed. */
export type FrameMessage =
  | { readonly boring: typeof FRAME_TAG; readonly type: 'ready' }
  | { readonly boring: typeof FRAME_TAG; readonly type: 'size'; readonly height: number }
  | { readonly boring: typeof FRAME_TAG; readonly type: 'error'; readonly message: string }
  | { readonly boring: typeof FRAME_TAG; readonly type: 'intent'; readonly name: string; readonly args: string };

const tagged = (data: unknown): data is { readonly boring: string; readonly type: unknown } =>
  typeof data === 'object' && data !== null && (data as { boring?: unknown }).boring === FRAME_TAG;

/** A message from the frame, or undefined when it is not one, or did not come from `frame` (the app's own iframe window). */
export function acceptFromFrame(event: { readonly data: unknown; readonly source: unknown }, frame: unknown): FrameMessage | undefined {
  if (!frame || event.source !== frame || !tagged(event.data)) return undefined;
  const m = event.data as Record<string, unknown>;
  if (m.type === 'ready') return { boring: FRAME_TAG, type: 'ready' };
  if (m.type === 'size' && typeof m.height === 'number' && Number.isFinite(m.height)) return { boring: FRAME_TAG, type: 'size', height: Math.min(Math.max(0, m.height), 20000) };
  if (m.type === 'error' && typeof m.message === 'string') return { boring: FRAME_TAG, type: 'error', message: m.message.slice(0, 2000) };
  if (m.type === 'intent' && typeof m.name === 'string' && typeof m.args === 'string') return { boring: FRAME_TAG, type: 'intent', name: m.name.slice(0, 100), args: m.args.slice(0, 200) };
  return undefined;
}

/** A render message, or undefined when it is not one, or did not come from `parent` (the frame's parent window). */
export function acceptFromParent(event: { readonly data: unknown; readonly source: unknown }, parent: unknown): RenderMessage | undefined {
  if (!parent || event.source !== parent || !tagged(event.data)) return undefined;
  const m = event.data as Record<string, unknown>;
  if (m.type !== 'render' || typeof m.source !== 'string' || typeof m.css !== 'string') return undefined;
  return { boring: FRAME_TAG, type: 'render', source: m.source, props: m.props, css: m.css, dark: m.dark === true };
}
