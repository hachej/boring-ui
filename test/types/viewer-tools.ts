import type { ViewerController, ViewerTarget, PresentationCommand } from '@hachej/boring-ui-kit';
import type { SaveResult, SaveSelection } from '@hachej/boring-ui-kit/resources';
import type { PublicationResult } from '@hachej/boring-files';

interface DocumentActions { revealHeading(heading: string): void; }
interface DocumentTools {
  readonly reveal: PresentationCommand<{ readonly heading: string }, void, { readonly documentId: string }>;
}

export function typedViewerManipulation(
  controller: ViewerController<{ readonly text: string }, DocumentActions, DocumentTools>,
  target: ViewerTarget<{ readonly documentId: string }>,
) {
  controller.actions.revealHeading('Scope');
  void controller.tools.reveal.invoke(target, { heading: 'Scope' });
  // @ts-expect-error Viewer tools preserve their input schema.
  void controller.tools.reveal.invoke(target, { wrongInput: 'Scope' });
}

export function preserveUncommittedOutcome(result: Exclude<PublicationResult, { readonly kind: 'committed' }>): SaveResult {
  return result;
}

/** Saving a genuinely new document does not fabricate a previous revision. */
export const newDocument: SaveSelection = {
  target: {
    instanceId: 'editor-a', epoch: 'mount-1',
    subject: {
      base: { kind: 'absent', target: { resource: { providerId: 'docs', path: '/new.md' }, view: { kind: 'published' } } },
      bufferVersion: 0,
      scopeId: 'fictional-project',
    },
  },
};
