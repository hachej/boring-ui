// The real props of a replaceable part, as the preview frame receives them by postMessage: structured-clone-safe values only. A function
// becomes an intent marker (the frame shows that it was called and runs nothing); anything that cannot be cloned (elements, class instances,
// symbols, cycles, very deep values) is dropped.
import { INTENT_KEY } from './frame-protocol';

const MAX_DEPTH = 6;

function walk(value: unknown, name: string, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'function') return { [INTENT_KEY]: name };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || depth >= MAX_DEPTH || seen.has(value)) return undefined;
  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.map((item, index) => walk(item, `${name}[${index}]`, depth + 1, seen) ?? null);
    seen.delete(value);
    return items;
  }
  const proto = Object.getPrototypeOf(value);
  if ((proto !== Object.prototype && proto !== null) || '$$typeof' in value) return undefined;
  seen.add(value);
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const kept = walk(item, key, depth + 1, seen);
    if (kept !== undefined) copy[key] = kept;
  }
  seen.delete(value);
  return copy;
}

/** The props a frame may receive. Never throws. */
export function snapshotProps(props: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  try { return (walk(props ?? {}, 'props', 0, new WeakSet()) as Record<string, unknown> | undefined) ?? {}; } catch { return {}; }
}
