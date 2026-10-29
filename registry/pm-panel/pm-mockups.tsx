'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import type { ArtifactDescriptor, PresentedArtifact } from '@hachej/boring-ui-kit/chat-view';
import { artifactVersionKey, recogniseArtifact } from '@hachej/boring-ui-kit/chat-view';
import { Button } from '@/components/ui/button';
import { InteractiveFrame } from '../viewer-frame/interactive-html';
import { Markdown } from '../pi-chat-markdown/markdown';
import { Shimmer } from '../pi-chat/shimmer';
import type { ChatArtifactCardProps, ChatArtifactsConfig } from '../pi-chat/config';
import type { PmText } from './pm-text';

/**
 * Reads a file the PM presented (`present`, a `boring.artifact` descriptor) as text, at the descriptor's revision; undefined when it can't.
 * The one line reads it through the app's PM door (`{base}/resources`, see `use-improve-agent.ts`).
 */
export type PmReadArtifact = (artifact: ArtifactDescriptor, signal: AbortSignal) => Promise<string | undefined>;

type Loaded = { readonly text: string } | { readonly failed: true } | undefined;
interface Mockups { readonly read: PmReadArtifact | undefined; readonly text: PmText; readonly cache: Map<string, Promise<string | undefined>> }
const MockupContext = createContext<Mockups | null>(null);

/** The panel's presented files: the reader and its cache (one read per revision, shared by the thumbnail and the full view). */
export function PmMockupProvider({ read, text, children }: { readonly read: PmReadArtifact | undefined; readonly text: PmText; readonly children: ReactNode }) {
  const [cache] = useState(() => new Map<string, Promise<string | undefined>>());
  const value = useMemo(() => ({ read, text, cache }), [read, text, cache]);
  return <MockupContext.Provider value={value}>{children}</MockupContext.Provider>;
}

function useMockup(artifact: ArtifactDescriptor | undefined): Loaded {
  const context = useContext(MockupContext);
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly value: Loaded }>();
  const key = artifact ? artifactVersionKey(artifact) : undefined;
  useEffect(() => {
    if (!artifact || !key || !context) return;
    const read = context.read;
    if (!read) return;
    let pending = context.cache.get(key);
    if (!pending) {
      const abort = new AbortController();
      pending = read(artifact, abort.signal).catch(() => undefined);
      context.cache.set(key, pending);
      void pending.then(text => { if (text === undefined) context.cache.delete(key); });
    }
    let current = true;
    void pending.then(text => { if (current) setLoaded({ key, value: text === undefined ? { failed: true } : { text } }); });
    return () => { current = false; };
  }, [artifact, key, context]);
  if (artifact && context && !context.read) return { failed: true };
  return loaded && loaded.key === key ? loaded.value : undefined;
}

/** The mockup itself: HTML and SVG in a sandboxed frame (scripts only, opaque origin, no network), Markdown drawn, anything else as text. */
function MockupBody({ artifact, text, testId }: { readonly artifact: ArtifactDescriptor; readonly text: string; readonly testId: string }) {
  if (artifact.type === 'html' || artifact.type === 'svg') return <InteractiveFrame text={text} sources={[]} title={artifact.title} testId={testId} />;
  if (artifact.type === 'markdown') return <div data-testid={`${testId}-markdown`} className="min-h-0 flex-1 overflow-auto p-4 text-[15px]"><Markdown text={text} /></div>;
  return <pre data-testid={`${testId}-text`} className="m-0 min-h-0 flex-1 overflow-auto p-4 text-xs whitespace-pre-wrap">{text}</pre>;
}

const descriptorOf = (artifact: ChatArtifactCardProps['artifact']): ArtifactDescriptor | undefined => {
  const descriptor = artifact.state === 'ready' ? artifact.descriptor as PresentedArtifact : undefined;
  return descriptor && descriptor.type !== 'task' ? descriptor : undefined;
};

/**
 * A presented mockup in the member thread (C7): one row per mockup, so two or three presented in a row read as a vertical list. A small
 * live thumbnail (the sandboxed page at phone width, scaled down), the title and « Ouvrir › »; the whole row (min 64px) opens it full height.
 */
export function PmArtifactCard({ artifact, open, onOpen }: ChatArtifactCardProps) {
  const context = useContext(MockupContext);
  const descriptor = descriptorOf(artifact);
  const loaded = useMockup(descriptor);
  const title = descriptor?.title ?? artifact.title ?? '';
  return <div data-testid="pm-mockup" data-state={artifact.state} data-open={open ? 'true' : undefined} className="relative my-1 flex min-h-16 w-full max-w-sm items-center gap-3 rounded-pm-box bg-background p-2 ring-1 ring-border">
    <div aria-hidden="true" inert className="relative h-24 w-16 shrink-0 overflow-hidden rounded-pm-control bg-muted ring-1 ring-border">
      {descriptor && loaded && 'text' in loaded && <div className="pointer-events-none absolute top-0 left-0 flex h-[585px] w-[390px] origin-top-left scale-[0.1641] flex-col">
        <MockupBody artifact={descriptor} text={loaded.text} testId="pm-mockup-thumb" />
      </div>}
    </div>
    <span className="flex min-w-0 flex-1 flex-col">
      <span data-testid="pm-mockup-title" className="truncate text-sm font-medium">{artifact.state === 'ready' ? title : <Shimmer>{title}</Shimmer>}</span>
      {loaded && 'failed' in loaded ? <span className="text-[13px] text-muted-foreground">{context?.text.mockupUnavailable}</span>
        : artifact.state === 'ready' && <span className="flex items-center text-[13px] text-muted-foreground">{context?.text.openMockup}<ChevronRightIcon className="size-3.5" aria-hidden="true" /></span>}
    </span>
    {descriptor && onOpen && <Button variant="link" data-testid="pm-mockup-open" aria-label={`${context?.text.openMockup ?? ''} ${title}`} onClick={onOpen} className="absolute inset-0 h-auto w-full" />}
  </div>;
}

/** The opened mockup, full height inside the sheet, under « ‹ Retour ». */
export function PmMockupView({ artifact, text, onBack }: { readonly artifact: ArtifactDescriptor; readonly text: PmText; readonly onBack: () => void }) {
  const loaded = useMockup(artifact);
  return <div data-testid="pm-mockup-view" className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 py-1 pr-4 pl-2">
      <Button variant="ghost" data-testid="pm-mockup-back" onClick={onBack} className="min-h-11">{text.back}</Button>
      <span data-testid="pm-mockup-view-title" className="min-w-0 flex-1 truncate text-right text-[13px] text-muted-foreground">{artifact.title}</span>
    </div>
    {loaded && 'text' in loaded ? <MockupBody artifact={artifact} text={loaded.text} testId="pm-mockup-full" />
      : <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{loaded ? text.mockupUnavailable : text.preparing}</p>}
  </div>;
}

/** The panel's artifacts config when the host gives none: `present` results become `PmArtifactCard`s that open in the sheet. */
export function pmArtifacts(open: (artifact: ArtifactDescriptor) => void, shown: ArtifactDescriptor | undefined): ChatArtifactsConfig {
  return {
    open: ((artifact: PresentedArtifact) => { if (artifact.type !== 'task') open(artifact); }) as ChatArtifactsConfig['open'],
    isOpen: ((artifact: PresentedArtifact) => shown !== undefined && artifact.type !== 'task' && artifactVersionKey(artifact) === artifactVersionKey(shown)) as NonNullable<ChatArtifactsConfig['isOpen']>,
    recognise: recogniseArtifact, Card: PmArtifactCard,
  };
}
