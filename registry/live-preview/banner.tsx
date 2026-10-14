'use client';
// The « Prévisualisation » banner (while an overlay is active) and the share note (after a share). The banner has « Fermer » and, when the
// host passes `onSharePreview`, « Partager ». It also shows the intent the frame reported, the error, and that the part is not on screen.
import { usePreview } from './provider';
import { previewText } from './preview-text';

const BUTTON = 'rounded-md px-3 py-1 text-sm hover:bg-background pointer-coarse:min-h-11 pointer-coarse:min-w-11';

export function PreviewBanner() {
  const preview = usePreview();
  const t = previewText(preview.locale);
  const { overlay } = preview;
  if (!overlay || !preview.enabled) return null;
  return <div data-testid="preview-banner" role="region" aria-label={`${t.banner} · ${overlay.title}`} className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2 text-sm text-foreground">
    <span className="min-w-0 flex-1 truncate font-medium">{t.banner} · {overlay.title}</span>
    {preview.onSharePreview && <button type="button" data-testid="preview-share" onClick={() => void preview.share()} className={BUTTON}>{t.share}</button>}
    <button type="button" data-testid="preview-close" onClick={preview.close} className={BUTTON}>{t.close}</button>
    {!preview.mounted.has(overlay.key) && <p data-testid="preview-absent" className="w-full text-xs text-muted-foreground">{t.absent}</p>}
    {preview.intent && <p data-testid="preview-intent" role="status" className="w-full truncate text-xs text-muted-foreground">{preview.intent}</p>}
    {preview.shareError && <p data-testid="preview-share-error" role="alert" className="w-full text-xs text-destructive">{preview.shareError}</p>}
    {preview.error && <p data-testid="preview-error" role="alert" className="w-full text-xs text-destructive">{preview.error}</p>}
  </div>;
}

/** The note after a share: the change is proposed, not applied; with the PR link when there is one. */
export function PreviewNote() {
  const preview = usePreview();
  const t = previewText(preview.locale);
  if (!preview.note) return null;
  return <div data-testid="preview-note" role="status" className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
    <span className="min-w-0 flex-1">{t.proposed}{preview.note.prUrl && <> — <a href={preview.note.prUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">{t.seeProposal}</a></>}</span>
    <button type="button" onClick={preview.dismissNote} className={BUTTON}>{t.close}</button>
  </div>;
}
