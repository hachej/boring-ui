'use client';

// The diagram viewer: an agent's `*.diagram.json` (format v1) drawn by `DiagramView`, with its highlighted path and note. `diagramKind` (diagram-kind.ts) is
// the kind the pi-app artifact panel uses by default for `.diagram.json` files; an app's own kind in `artifactKinds` wins. The maquette
// viewer draws its workflow ("How it works") with the same `DiagramView`. It draws data only: nothing in the file runs.
import { useMemo } from 'react';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DIAGRAM_FORMAT_VERSION, parseDiagram } from './diagram';
import { diagramLabelsFor } from './diagram-labels';
import type { DiagramLabels, DiagramLocale } from './diagram-labels';
import { DiagramView } from './diagram-view';

export { DIAGRAM_FORMAT_VERSION, isDiagramPath, parseDiagram } from './diagram';
export type { Diagram, DiagramEdge, DiagramFileV1, DiagramGroup, DiagramNode, DiagramParse } from './diagram';
export { DiagramView } from './diagram-view';
export type { DiagramViewLabels } from './diagram-view';
export { defaultDiagramLabels, diagramLabelsFor, frenchDiagramLabels } from './diagram-labels';
export type { DiagramLabels, DiagramLocale } from './diagram-labels';

export interface DiagramViewerProps {
  /** The file's text (JSON). */
  readonly text: string;
  /** The base words: English by default. */
  readonly locale?: DiagramLocale | undefined;
  /** Any word over the locale's. */
  readonly labels?: Partial<DiagramLabels> | undefined;
}

/** A diagram file; a newer format version shows a notice, an unreadable file an inline error. */
export function DiagramViewer({ text, locale, labels: given }: DiagramViewerProps) {
  const labels = useMemo(() => diagramLabelsFor(locale, given), [locale, given]);
  const parsed = useMemo(() => parseDiagram(text), [text]);
  const newer = parsed.version !== undefined && parsed.version > DIAGRAM_FORMAT_VERSION;
  return <section data-boring="diagram-viewer" data-state={parsed.kind} aria-label={parsed.kind === 'ok' ? parsed.diagram.title || labels.kind : labels.kind}
    className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-3 px-3 pt-2 pb-4 sm:px-6">
    {newer && <Alert data-testid="diagram-newer"><InfoIcon aria-hidden="true" /><AlertTitle>{labels.newerTitle}</AlertTitle><AlertDescription>{labels.newer(parsed.version!)}</AlertDescription></Alert>}
    {parsed.kind === 'ok' ? <DiagramView diagram={parsed.diagram} labels={labels} />
      : <Alert variant="destructive" data-testid="diagram-error" data-reason={parsed.reason}><TriangleAlertIcon aria-hidden="true" /><AlertTitle>{labels.errorTitle}</AlertTitle>
        <AlertDescription>{parsed.reason === 'json' ? labels.invalidJson : labels.invalidShape}</AlertDescription></Alert>}
  </section>;
}
