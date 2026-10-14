'use client';
// The « Prévisualisation » banner and the share note. Both render nothing when the preview is off; the banner also needs an overlay.
import { useContext } from 'react';
import { PreviewContext } from './provider';
import { previewText } from './preview-text';

export function PreviewStatus() {
  const preview = useContext(PreviewContext);
  const t = previewText(preview.locale);
  if (!preview.enabled) return null;
  return <>
    {preview.overlays.length > 0 && <div data-testid="preview-banner" role="region" aria-label={t.banner}
      className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2 text-sm text-foreground">
      <span className="font-medium">{t.banner}</span>
      {preview.overlays.map(overlay => <span key={overlay.key} className="inline-flex items-center gap-1">
        <code className="text-xs">{overlay.key}</code>
        {preview.canShare && <button type="button" onClick={() => void preview.share(overlay.key)}
          className="rounded-md px-2 py-1 underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11">{t.share}</button>}
        <button type="button" data-testid={`preview-close-${overlay.key}`} aria-label={t.closeKey(overlay.key)} onClick={() => preview.remove(overlay.key)}
          className="rounded-md px-2 py-1 hover:bg-background pointer-coarse:min-h-11 pointer-coarse:min-w-11">×</button>
      </span>)}
      <button type="button" onClick={() => preview.setShown(!preview.shown)}
        className="rounded-md px-2 py-1 underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11">{preview.shown ? t.hide : t.show}</button>
      <button type="button" onClick={() => preview.clearAll()}
        className="rounded-md px-2 py-1 underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11">{t.cancelAll}</button>
    </div>}
    {preview.note && <div data-testid="preview-note" role="status" className="border-b border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
      {t.proposed}{preview.note.prUrl && <> — <a href={preview.note.prUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">{t.seeProposal}</a></>}
    </div>}
  </>;
}
