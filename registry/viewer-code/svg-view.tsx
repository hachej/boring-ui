'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CodeXmlIcon, EyeIcon } from 'lucide-react';
import { CodeBlock } from '../pi-chat/code-block';
import { ViewerToggle } from '../viewer-frame/viewer-frame';
import { useViewerText } from '../viewer-frame/viewer-window';

/** What the code kinds' views read of the panel's kind props (structurally `ArtifactKindViewProps` of pi-artifacts). */
export interface CodeViewProps {
  readonly text: string;
  readonly artifact: { readonly title: string };
  /** The panel bar's controls slot (the preview and source toggle goes there). */
  readonly setControls?: ((controls: ReactNode) => void) | undefined;
}

/** An SVG artifact: a preview, or its source. The preview is an image from a blob URL: it never becomes markup in this page, so its scripts cannot run. */
export function SvgView({ text, artifact, setControls }: CodeViewProps) {
  const { labels } = useViewerText();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const url = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })), [text]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    setControls?.(<ViewerToggle label={labels.view} value={mode} onChange={setMode} options={[
      { id: 'preview', label: labels.preview, text: labels.preview, icon: <EyeIcon className="size-4" aria-hidden="true" />, testId: 'artifact-mode' },
      { id: 'source', label: labels.source, text: labels.source, icon: <CodeXmlIcon className="size-4" aria-hidden="true" />, testId: 'artifact-mode' }]} />);
    return () => setControls?.(undefined);
  }, [setControls, mode, labels.view, labels.preview, labels.source]);
  return mode === 'preview'
    ? <div className="boring-viewer-checker flex h-full min-h-0 items-center justify-center overflow-auto p-6"><img data-testid="artifact-svg" src={url} alt={artifact.title} className="max-h-full max-w-full" /></div>
    : <div className="min-h-0 p-3"><CodeBlock code={text} language="svg" /></div>;
}
