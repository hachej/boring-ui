import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }

/** Thrown when no automatic copy worked; `text` is what the person must copy by hand (a viewer shows it selected). */
export class ManualCopyError extends Error {
  constructor(readonly text: string) { super('Copy the text by hand'); this.name = 'ManualCopyError'; }
}

/**
 * Copies `text` using the host's callback when given, else the async Clipboard API (secure contexts only), else a hidden
 * textarea and `document.execCommand('copy')` (works over plain HTTP). Throws `ManualCopyError` when none worked.
 * This is the one place this item touches the clipboard; `npm run check` keeps it that way.
 */
export async function copyText(text: string, onCopy?: (text: string) => Promise<void>): Promise<void> {
  if (onCopy) return onCopy(text);
  try { const clipboard = globalThis.navigator?.clipboard; if (clipboard) { await clipboard.writeText(text); return; } }
  catch { /* denied or unfocused: use the selection route */ }
  const doc = globalThis.document;
  if (doc?.body && typeof doc.execCommand === 'function') {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    const focus = doc.activeElement instanceof HTMLElement ? doc.activeElement : undefined;
    doc.body.append(area);
    try { area.select(); area.setSelectionRange(0, text.length); if (doc.execCommand('copy')) return; }
    catch { /* fall through */ }
    finally { area.remove(); focus?.focus({ preventScroll: true }); }
  }
  throw new ManualCopyError(text);
}

/**
 * A block's `labels` or `icons`: `defaults` with each partial override on top, later ones winning. A key an override leaves `undefined`
 * keeps the value below it, so a host can pass `{ title: maybe }` safely.
 */
export function withDefaults<T extends object>(defaults: T, ...overrides: readonly (Partial<T> | undefined)[]): T {
  const merged: Record<string, unknown> = { ...defaults as Record<string, unknown> };
  for (const override of overrides) for (const [key, value] of Object.entries(override ?? {})) if (value !== undefined) merged[key] = value;
  return merged as T;
}
