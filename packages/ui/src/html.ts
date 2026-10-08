import type { ReadResult } from '@hachej/boring-files';
import type { TextDraftActions, TextDraftOptions } from './text-draft-types.js';
import type { EditableViewerController, SaveResult, SaveSelection } from './resources.js';
import { createTextBuffer } from './text-buffer.js';
import type { TextBufferOptions, TextBufferSource, TextBufferState } from './text-buffer.js';

export type HtmlSource = TextBufferSource;
export type HtmlState = TextBufferState;
export type HtmlOptions = Pick<TextBufferOptions, 'identity' | 'instanceId' | 'epoch' | 'source' | 'client' | 'readOnly' | 'onListenerError'> & { readonly drafts?: TextDraftOptions };
export interface HtmlActions extends TextDraftActions {
  readonly edit: (text: string) => void;
  readonly selection: () => SaveSelection;
  readonly refresh: () => Promise<ReadResult>;
  readonly discardToRemote: () => Promise<ReadResult>;
  readonly reconcile: () => Promise<SaveResult>;
  /** For an unconfirmed save: stop reconciling and refresh, keeping the draft. The save is never reported committed or replayed. */
  readonly abandon: () => Promise<ReadResult>;
}
export type HtmlController = EditableViewerController<HtmlState, HtmlActions, undefined>;

export function createHtmlController(options: HtmlOptions): HtmlController {
  const { drafts, ...bufferOptions } = options;
  const buffer = createTextBuffer({ ...bufferOptions, ...(drafts ? { drafts: { ...drafts, format: 'html/v1' } } : {}), mediaType: 'text/html', readText: snapshot => {
    if (snapshot.mediaType !== 'text/html') throw new TypeError('Expected HTML');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
  } });
  return {
    getSnapshot: buffer.getSnapshot,
    subscribe: buffer.subscribe,
    actions: {
      edit: text => buffer.edit(text), selection: buffer.selection,
      checkDrafts: buffer.checkDrafts, checkpointDraft: buffer.checkpointDraft, restoreDraft: buffer.restoreDraft, discardDraft: buffer.discardDraft,
      refresh: () => buffer.refresh(false), discardToRemote: () => buffer.refresh(true), reconcile: buffer.reconcile, abandon: buffer.abandon,
    },
    tools: undefined,
    flush: buffer.flush,
    dispose: buffer.dispose,
  };
}
