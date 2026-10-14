'use client';
// The chat card for a `boring.preview` tool result. Nothing opens until the viewer clicks.
import type { ChatCard } from '../pi-chat/rows';
import { usePreview } from './provider';
import type { PreviewSource } from './provider';
import { previewText } from './preview-text';

/** The part of a tool result that the card reads (the chat passes pi's own message types). */
export interface PreviewResult {
  readonly details?: unknown;
}

function PreviewButton({ preview: source }: { readonly preview: PreviewSource }) {
  const preview = usePreview();
  const t = previewText(preview.locale);
  return <button type="button" disabled={!preview.enabled} onClick={() => preview.open(source)}
    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11">
    {t.preview} <span className="text-xs text-muted-foreground">{source.title}</span>
  </button>;
}

/** The card for a finished `boring.preview` result (`details: { kind, previewId, title, source, sampleProps? }`), or undefined for any other result. */
export function previewCardFor(result: PreviewResult | undefined, _call?: { readonly id: string }): ChatCard | undefined {
  const d = result?.details as { readonly kind?: unknown; readonly previewId?: unknown; readonly title?: unknown; readonly source?: unknown; readonly sampleProps?: unknown } | undefined;
  if (d?.kind !== 'boring.preview' || typeof d.previewId !== 'string' || typeof d.title !== 'string' || typeof d.source !== 'string') return undefined;
  return { content: <PreviewButton preview={{ previewId: d.previewId, title: d.title, source: d.source, sampleProps: d.sampleProps }} /> };
}
