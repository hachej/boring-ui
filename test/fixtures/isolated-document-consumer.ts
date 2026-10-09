import { PublicationNotDispatchedError } from '@hachej/boring-files/publication';
import type { ViewerFeature } from '@hachej/boring-ui-kit';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { MarkdownController, MarkdownOptions } from '@hachej/boring-ui-kit/markdown';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';
import type { ResourceClientOptions, ResourceHandlerOptions, ResourceIdentity } from '@hachej/boring-files/remote';
import type { ResourceClient, ResourceProvider } from '@hachej/boring-files';
import type { TextDraftChoiceSelection, TextDraftOptions, TextDraftCheckpointResult } from '@hachej/boring-ui-kit/text-buffer';

declare const remoteOptions: ResourceClientOptions;
declare const handlerOptions: ResourceHandlerOptions;
const remote: ResourceClient = createResourceClient(remoteOptions);
const handle: (request: Request) => Promise<Response> = createResourceHandler(handlerOptions);
const expectedIdentity: ResourceIdentity = remoteOptions.identity;
void remote;
void handle;
void expectedIdentity;

declare const options: MarkdownOptions;
const editor = createMarkdownController(options);
const result = editor.flush(editor.actions.selection());
declare const feature: ViewerFeature<{ kind: 'markdown'; version: 1 }, MarkdownController>;
feature.createController({ kind: 'markdown', version: 1 }).flush(editor.actions.selection());
void result;
// The workspace provider is a ResourceProvider; the handler borrows it like any other (its declarations name Pi's FileSystem,
// so the runtime consumer, not this one, imports it: this consumer installs no Pi).
declare const workspace: ResourceProvider & { readonly publication: NonNullable<ResourceProvider['publication']>; readonly reconciliation: NonNullable<ResourceProvider['reconciliation']> };
void createResourceHandler({ authenticate: async () => null, reader: workspace, publisher: workspace.publication, lookup: workspace.reconciliation });

const concrete = feature.createController({ kind: 'markdown', version: 1 });
void concrete.tools.inspect.invoke(editor.actions.selection().target, { expiresAt: Date.now() + 1000 });
void concrete.actions.propose(editor.actions.selection(), [{ find: 'before', replace: 'after' }]);
// @ts-expect-error Concrete proposal inputs cannot silently lose their exact edit shape.
concrete.actions.propose(editor.actions.selection(), [{ replacement: 'wrong' }]);

const notDispatched = new PublicationNotDispatchedError('fictional-operation');
const operationId: string = notDispatched.operationId;
void operationId;

declare const drafts: TextDraftOptions;
declare const choice: TextDraftChoiceSelection;
const recoverable = createMarkdownController({ ...options, drafts });
const checkpoint: Promise<TextDraftCheckpointResult> = recoverable.actions.checkpointDraft();
void recoverable.actions.restoreDraft(choice);
void concrete.actions.discardDraft(choice);
void checkpoint;
