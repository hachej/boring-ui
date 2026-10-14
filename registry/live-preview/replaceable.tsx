'use client';
// `<Replaceable>` marks a part of a screen that a live preview may replace, in place. It registers its key and source file (`listReplaceables()`
// is the one key to file mapping, for the host to give the PM). While an overlay for its key is active it renders the sandboxed frame, with a
// snapshot of its real `props`, instead of `children`; on an error, or when the preview is off or closed, the original renders again.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { PreviewFrame } from './frame';
import { usePreview } from './provider';
import { previewText } from './preview-text';
import type { PreviewLocale } from './preview-text';

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
  /** The real props of the part: the frame gets a snapshot (clone-safe values; functions become intent stubs, the rest is dropped). */
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children: ReactNode;
}

export function Replaceable({ id, source, props, children }: ReplaceableProps) {
  const { enabled, overlay, error, register } = usePreview();
  useEffect(() => {
    replaceables.set(id, { key: id, filePath: source });
    const unregister = register(id);
    return () => { replaceables.delete(id); unregister(); };
  }, [id, source, register]);
  if (!enabled || overlay?.key !== id || error) return <>{children}</>;
  return <PreviewFrame overlay={overlay} props={props} />;
}

/**
 * The replaceable parts as context lines for the PM (the improve chat only): « Parties remplaçables:\n<key> -> <filePath> », or undefined when
 * none is mounted. Use it in the improve chat's `requestContext`, read at each submit: `() => ({ ...readAgentContext(), ...replaceablesContext(locale) })`.
 */
export function replaceablesContext(locale: PreviewLocale = 'fr'): { readonly replaceables: string } | undefined {
  const entries = listReplaceables();
  return entries.length ? { replaceables: [previewText(locale).replaceables, ...entries.map(entry => `${entry.key} -> ${entry.filePath}`)].join('\n') } : undefined;
}
