'use client';
// The chat card for a `boring.preview` tool result. Nothing applies until the viewer clicks: the click adds the overlay.
import { useContext } from 'react';
import type { ChatCard } from '../pi-chat/rows';
import { PreviewContext } from './provider';
import { previewText } from './preview-text';

/** The parts of a tool result and of its call that the card reads (the chat passes pi's own message types). */
export interface PreviewResult {
  readonly details?: unknown;
}

function PreviewButton({ overlay, previewId }: { readonly overlay: { readonly key: string; readonly source: string }; readonly previewId: string }) {
  const preview = useContext(PreviewContext);
  if (!preview.enabled) return null;
  const t = previewText(preview.locale);
  return <button type="button" onClick={() => preview.add({ key: overlay.key, source: overlay.source, previewId })}
    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:bg-muted pointer-coarse:min-h-11">
    {t.preview} <code className="text-xs">{overlay.key}</code>
  </button>;
}

/** The card for a finished `boring.preview` result (`details: { kind, key, source }`), or undefined for any other result. */
export function previewCardFor(result: PreviewResult | undefined, call: { readonly id: string }): ChatCard | undefined {
  const details = result?.details as { readonly kind?: unknown; readonly key?: unknown; readonly source?: unknown } | undefined;
  if (details?.kind !== 'boring.preview' || typeof details.key !== 'string' || typeof details.source !== 'string') return undefined;
  return { content: <PreviewButton overlay={{ key: details.key, source: details.source }} previewId={call.id} /> };
}
