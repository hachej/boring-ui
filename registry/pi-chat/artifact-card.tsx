'use client';

import type { ComponentType } from 'react';
import { CheckIcon, ChevronRightIcon, FileCodeIcon, FileTextIcon, GlobeIcon, ImageIcon, PenToolIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Shimmer } from './shimmer';
import { artifactKey, artifactKind, typeLabel } from './artifact';
import type { ArtifactDescriptor, ArtifactKind, ArtifactType } from './artifact';
import { useChatText } from './labels';

const ICONS: Record<ArtifactType, ComponentType<{ readonly 'aria-hidden'?: boolean | 'true' }>> = {
  markdown: FileTextIcon, html: GlobeIcon, svg: ImageIcon, code: FileCodeIcon, canvas: PenToolIcon,
};

/**
 * An artifact in the transcript, as in Claude's chat apps: a compact card with a type icon, the title, the type and the
 * version. Clicking it asks the host to open the artifact. While the `present` call that makes it is still running it is a quiet
 * "opening" card with a shimmer. Rendered outside the activity block, like the question card.
 */
export function ArtifactCard({ artifact, pending, title, open = false, onOpen, kinds }: {
  readonly artifact?: ArtifactDescriptor | undefined;
  readonly pending?: 'presenting';
  readonly title?: string | undefined;
  readonly open?: boolean;
  readonly onOpen?: ((artifact: ArtifactDescriptor) => void) | undefined;
  /** The app's artifact kinds (`ArtifactsConfig.kinds`): their label and icon win over the type's. */
  readonly kinds?: readonly ArtifactKind[] | undefined;
}) {
  const { labels } = useChatText();
  if (!artifact) {
    return <Item variant="outline" size="sm" data-testid="artifact-card" data-state={pending ?? 'presenting'} role="status" aria-busy="true" className="my-2 text-start">
      <ItemMedia variant="image"><Item variant="muted" size="xs" className="min-h-full justify-center"><ItemMedia variant="icon"><FileTextIcon aria-hidden="true" /></ItemMedia></Item></ItemMedia>
      <ItemContent className="min-w-0 basis-0">
        <ItemTitle data-testid="artifact-title"><Shimmer>{title ?? labels.artifact}</Shimmer></ItemTitle>
        <ItemDescription><Shimmer>{labels.opening}</Shimmer></ItemDescription>
      </ItemContent>
    </Item>;
  }
  const kind = artifactKind(artifact, kinds);
  const Icon = kind?.icon ?? ICONS[artifact.type];
  return <Button variant={open ? 'secondary' : 'outline'} disabled={!onOpen} onClick={() => onOpen?.(artifact)}
    data-testid="artifact-card" data-state="ready" data-artifact-id={artifactKey(artifact)} data-artifact-revision={artifact.revision} data-artifact-version={artifact.ordinal} data-artifact-type={artifact.type} data-artifact-kind={kind?.label}
    data-open={open ? 'true' : undefined} aria-pressed={onOpen ? open : undefined} aria-label={labels.openArtifact(artifact.title, artifact.ordinal)}
    className="my-2 h-auto min-h-12! w-full max-w-md justify-start gap-2.5 text-left">
    <ItemMedia variant="image"><Item variant="muted" size="xs" className="min-h-full justify-center"><Icon aria-hidden="true" /></Item></ItemMedia>
    <span className="flex min-w-0 flex-1 flex-col">
      <span data-testid="artifact-title" className="truncate">{artifact.title}</span>
      <span className="truncate text-xs text-muted-foreground"><span data-testid="artifact-type">{typeLabel(artifact, kinds, labels.artifactTypes)}</span>{artifact.ordinal !== undefined && <> · <span data-testid="artifact-version">{labels.version(artifact.ordinal)}</span></>}</span>
    </span>
    {open ? <CheckIcon data-icon="inline-end" aria-hidden="true" /> : <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />}
  </Button>;
}
