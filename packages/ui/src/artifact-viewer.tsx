'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Marked } from 'marked';
import { passiveHtml } from './passive-html.js';

export interface ArtifactPdfProps {
  readonly name: string;
  readonly url: string;
}

export interface ArtifactViewerProps {
  readonly name: string;
  readonly mimeType: string;
  /** Content takes precedence over a URL. Byte content must be replaced, not mutated in place. */
  readonly content?: string | Uint8Array;
  /** Borrowed host URL; used only for images and PDF, never fetched for text previews. */
  readonly url?: string;
  readonly className?: string;
  /** Trusted host presentation, for example a separately installed pdfjs renderer. */
  readonly renderPdf?: (props: ArtifactPdfProps) => ReactNode;
}

type ArtifactKind = 'markdown' | 'html' | 'pdf' | 'image' | 'text';
const markdown = new Marked();
const imageTypes: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };

function artifactType(name: string, mimeType: string): { kind: ArtifactKind; mimeType: string } | undefined {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase();
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return { kind: 'markdown', mimeType: mime };
  if (mime === 'text/html') return { kind: 'html', mimeType: mime };
  if (mime === 'application/pdf') return { kind: 'pdf', mimeType: mime };
  if (mime.startsWith('image/')) return { kind: 'image', mimeType: mime };
  if (/^(?:audio|video)\//.test(mime)) return undefined;
  const basename = name.slice(name.lastIndexOf('/') + 1), dot = basename.lastIndexOf('.');
  const extension = dot === -1 ? '' : basename.slice(dot + 1).toLowerCase();
  if (extension === 'md' || extension === 'markdown') return { kind: 'markdown', mimeType: 'text/markdown' };
  if (extension === 'html' || extension === 'htm') return { kind: 'html', mimeType: 'text/html' };
  if (extension === 'pdf') return { kind: 'pdf', mimeType: 'application/pdf' };
  const imageType = Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
  if (imageType) return { kind: 'image', mimeType: imageType };
  if (/^(?:mp4|webm|mov|m4v|ogg|ogv|mp3|wav)$/.test(extension)) return undefined;
  return { kind: 'text', mimeType: mime };
}

function decodeText(content: string | Uint8Array | undefined): string | undefined {
  if (content === undefined) return undefined;
  if (typeof content === 'string') return content.includes('\0') ? undefined : content;
  if (content.includes(0)) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); } catch { return undefined; }
}

function Unavailable() {
  return <p role="status">Preview unavailable.</p>;
}

function PassiveArtifact({ name, text, kind }: { readonly name: string; readonly text: string; readonly kind: 'markdown' | 'html' }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    host.replaceChildren();
    try {
      if (text.length > 262_144) throw new RangeError('Artifact preview source exceeds its limit');
      const source = passiveHtml(kind === 'markdown' ? markdown.parse(text, { async: false }) : text, host.ownerDocument);
      const frame = host.ownerDocument.createElement('iframe');
      frame.setAttribute('sandbox', '');
      frame.referrerPolicy = 'no-referrer';
      frame.title = name;
      frame.srcdoc = source;
      host.replaceChildren(frame);
      setReady(true);
    } catch {
      host.replaceChildren();
      setReady(false);
    }
    return () => { host.replaceChildren(); };
  }, [name, text, kind]);
  return <>{!ready && <Unavailable />}<div ref={container} /></>;
}

function mediaUrl(url: string | undefined, kind: 'image' | 'pdf'): string | undefined {
  if (!url) return undefined;
  try {
    const protocol = new URL(url, 'https://artifact.invalid/').protocol;
    if (['https:', 'http:', 'blob:'].includes(protocol)) return url;
    if (protocol === 'data:' && (kind === 'image' ? /^data:image\//i : /^data:application\/pdf(?:;|,)/i).test(url)) return url;
  } catch { /* A malformed host URL has no preview. */ }
  return undefined;
}

function MediaArtifact({ name, kind, mimeType, content, url, renderPdf }: ArtifactViewerProps & { readonly kind: 'image' | 'pdf' }) {
  const [made, setMade] = useState<{ content: string | Uint8Array; mimeType: string; url: string }>();
  useLayoutEffect(() => {
    if (content === undefined) { setMade(undefined); return; }
    try {
      const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      setMade({ content, mimeType, url: objectUrl });
      return () => { URL.revokeObjectURL(objectUrl); };
    } catch { setMade(undefined); }
  }, [content, mimeType]);
  const selectedUrl = content === undefined ? mediaUrl(url, kind) : made?.content === content && made.mimeType === mimeType ? made.url : undefined;
  if (!selectedUrl) return <Unavailable />;
  if (kind === 'image') return <img src={selectedUrl} alt={name} referrerPolicy="no-referrer" />;
  return renderPdf ? renderPdf({ name, url: selectedUrl }) : <iframe src={selectedUrl} title={name} sandbox="" referrerPolicy="no-referrer" />;
}

export function ArtifactViewer(props: ArtifactViewerProps) {
  const type = artifactType(props.name, props.mimeType);
  const text = type && type.kind !== 'image' && type.kind !== 'pdf' ? decodeText(props.content) : undefined;
  return <section data-boring="artifact-viewer" className={props.className} aria-label={props.name}>
    {!type ? <Unavailable /> : type.kind === 'image' || type.kind === 'pdf'
      ? <MediaArtifact {...props} kind={type.kind} mimeType={type.mimeType} />
      : text === undefined ? <Unavailable /> : type.kind === 'text'
        ? <pre>{text}</pre>
        : <PassiveArtifact name={props.name} text={text} kind={type.kind} />}
  </section>;
}
