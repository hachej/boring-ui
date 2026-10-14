'use client';
// `<Replaceable>` marks a part of a screen that a live preview may replace. It registers its key and source file; while an overlay for
// its key is active (enabled, shown and not expired) it renders a placeholder slot and the original. Otherwise the original alone.
// The frame that renders the replacement is a later part (PR 2); until then the slot says the preview is unavailable.
import { useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { PreviewContext } from './provider';
import { previewText } from './preview-text';

export interface ReplaceableEntry {
  readonly key: string;
  readonly filePath: string;
}

const replaceables = new Map<string, ReplaceableEntry>();

/** The key to source file mapping of the mounted replaceables. The host resolves a file from a key here. */
export function listReplaceables(): readonly ReplaceableEntry[] {
  return [...replaceables.values()];
}

export interface ReplaceableProps {
  readonly id: string;
  readonly source: string;
  /** Serialisable props the replacement receives (used by the frame, PR 2). */
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children: ReactNode;
}

export function Replaceable({ id, source, children }: ReplaceableProps) {
  const { enabled, overlays, shown, locale } = useContext(PreviewContext);
  useEffect(() => {
    replaceables.set(id, { key: id, filePath: source });
    return () => { replaceables.delete(id); };
  }, [id, source]);
  const active = enabled && shown && overlays.some(overlay => overlay.key === id);
  if (!active) return <>{children}</>;
  return <>
    <div data-boring-preview-slot={id} className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{previewText(locale).unavailable}</div>
    {children}
  </>;
}
