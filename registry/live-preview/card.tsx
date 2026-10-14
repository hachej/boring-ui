'use client';
// The chat card for a `boring.preview` tool result. Nothing is replaced until the viewer clicks.
import type { ChatCard } from '../pi-chat/rows';
import { usePreview } from './provider';
import type { PreviewOverlay } from './provider';
import { previewText } from './preview-text';

/** The part of a tool result that the card reads (the chat passes pi's own message types). */
export interface PreviewResult {
  readonly details?: unknown;
}

function PreviewButton({ overlay }: { readonly overlay: PreviewOverlay }) {
  const preview = usePreview();
  const t = previewText(preview.locale);
  return <button type="button" disabled={!preview.enabled} onClick={() => preview.open(overlay)}
    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11">
    {t.preview} <span className="text-xs text-muted-foreground">{overlay.title}</span>
  </button>;
}

/** The card for a finished `boring.preview` result (`details: { kind, previewId, key, title, source }`), or undefined for any other result. */
export function previewCardFor(result: PreviewResult | undefined, _call?: { readonly id: string }): ChatCard | undefined {
  const d = result?.details as Record<string, unknown> | undefined;
  if (d?.kind !== 'boring.preview' || typeof d.previewId !== 'string' || typeof d.key !== 'string' || typeof d.title !== 'string' || typeof d.source !== 'string') return undefined;
  return { content: <PreviewButton overlay={{ previewId: d.previewId, key: d.key, title: d.title, source: d.source }} /> };
}
