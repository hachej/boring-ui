'use client';

import type { ComponentType } from 'react';
import { ChevronRightIcon, FileCodeIcon, FileTextIcon, GlobeIcon, ImageIcon, PenToolIcon } from 'lucide-react';
import { Shimmer } from './shimmer';
import { artifactKey, typeLabel } from './artifact';
import type { ArtifactDescriptor, ArtifactType } from './artifact';
import { cn } from '../utils/utils';
import { useChatText } from './labels';

const ICONS: Record<ArtifactType, ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>> = {
  markdown: FileTextIcon, html: GlobeIcon, svg: ImageIcon, code: FileCodeIcon, canvas: PenToolIcon,
};

/**
 * An artifact in the transcript, as in Claude's chat apps: a compact card with a type icon, the title, the type and the
 * version. Clicking it asks the host to open the artifact. While the `present` call that makes it is still running it is a quiet
 * "opening" card with a shimmer. Rendered outside the activity block, like the question card.
 */
export function ArtifactCard({ artifact, pending, title, open = false, onOpen }: {
  readonly artifact?: ArtifactDescriptor | undefined;
  readonly pending?: 'presenting';
  readonly title?: string | undefined;
  readonly open?: boolean;
  readonly onOpen?: ((artifact: ArtifactDescriptor) => void) | undefined;
}) {
  const { labels } = useChatText();
  if (!artifact) {
    return <div data-testid="artifact-card" data-state={pending ?? 'presenting'} role="status" aria-busy="true"
      className="my-2 flex min-h-16 items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileTextIcon className="size-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span data-testid="artifact-title" className="block truncate text-sm font-medium"><Shimmer>{title ?? labels.artifact}</Shimmer></span>
        <span className="block text-xs text-muted-foreground"><Shimmer>{labels.opening}</Shimmer></span>
      </span>
    </div>;
  }
  const Icon = ICONS[artifact.type];
  return <button type="button" data-testid="artifact-card" data-state="ready" data-artifact-id={artifactKey(artifact)} data-artifact-revision={artifact.revision} data-artifact-version={artifact.ordinal} data-artifact-type={artifact.type}
    data-open={open ? 'true' : undefined} aria-pressed={onOpen ? open : undefined} aria-label={labels.openArtifact(artifact.title, artifact.ordinal)} disabled={!onOpen}
    onClick={() => onOpen?.(artifact)}
    className={cn('group/artifact my-2 flex min-h-16 w-full max-w-md cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left text-card-foreground shadow-xs outline-none transition-[border-color,background-color,box-shadow] motion-reduce:transition-none',
      'hover:border-ring/50 hover:bg-muted/40 hover:shadow-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default',
      open ? 'border-ring bg-muted/50' : 'border-border')}>
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors motion-reduce:transition-none', open ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover/artifact:bg-background group-hover/artifact:text-foreground')}>
      <Icon className="size-5" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1">
      <span data-testid="artifact-title" className="block truncate text-sm leading-5 font-medium">{artifact.title}</span>
      <span className="block truncate text-xs leading-5 text-muted-foreground"><span data-testid="artifact-type">{typeLabel(artifact)}</span>{artifact.ordinal !== undefined && <> · <span data-testid="artifact-version">{labels.version(artifact.ordinal)}</span></>}</span>
    </span>
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <span data-testid="artifact-hint" className={cn(open ? 'font-medium text-foreground' : 'opacity-0 transition-opacity group-hover/artifact:opacity-100 group-focus-visible/artifact:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 max-sm:opacity-100')}>{open ? labels.viewing : labels.open}</span>
      <ChevronRightIcon className="size-4" aria-hidden="true" />
    </span>
  </button>;
}
