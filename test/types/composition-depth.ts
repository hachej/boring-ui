import type { ViewerController, ViewerDescriptor, ViewerFeature, ViewerRenderer } from '@hachej/boring-ui-kit';
import type { EditableViewerController, SaveSelection } from '@hachej/boring-ui-kit/resources';
import type { FileSystem, Shell, ExecutionEnv, EnvironmentFactory, WorkspaceLease, WorkspaceProvider } from '@hachej/boring-execution';
import type { Context } from '@earendil-works/chord';

interface NoteDescriptor extends ViewerDescriptor { readonly kind: 'note'; readonly version: 1; readonly noteId: string; }
interface NoteEditor extends EditableViewerController<{ readonly text: string }, {}, {}> {
  readonly focusHeading: (heading: string) => void;
  readonly getServerSnapshot: () => { readonly text: string };
}
declare const feature: ViewerFeature<NoteDescriptor, NoteEditor>;
export const editor = feature.createController({ kind: 'note', version: 1, noteId: 'fictional' });
declare const selection: SaveSelection;
void editor.flush(selection); // Previously lost through ViewerFeature's base return type.
editor.focusHeading('Scope');
editor.getServerSnapshot();
export const renderer: ViewerRenderer<NoteEditor, string> = c => c.getSnapshot().text;
renderer(editor);

declare const genericFeature: ViewerFeature<NoteDescriptor, ViewerController<{}, {}, {}>>;
// @ts-expect-error A base controller cannot advertise the editor's extra capabilities.
const incompatible: ViewerFeature<NoteDescriptor, NoteEditor> = genericFeature;
void incompatible;

/** Explicit await supports async owner teardown without pretending a Promise
 * is synchronous React effect cleanup. Existing synchronous controllers fit.
 */
export async function closeEditor(c: NoteEditor): Promise<void> { await c.dispose(); }

interface ShellInput { readonly container: string; }
declare const shellProvider: WorkspaceProvider<ShellInput, Shell>;
declare const context: Context;
export async function shellOnly() {
  const lease = await shellProvider.acquire({ operationId: 'run-a', input: { container: 'test' } }, context);
  await lease.environment.exec('pwd', undefined, context);
  // @ts-expect-error A shell does not magically provide filesystem access.
  void lease.environment.readTextFile('file', context);
  // @ts-expect-error A native env factory must not be fed an incomplete shell.
  const env: EnvironmentFactory = () => lease.environment;
  void env;
}

declare const files: WorkspaceLease<FileSystem>;
// @ts-expect-error File-only lease still cannot promise full native execution.
const coding: WorkspaceLease<ExecutionEnv> = files;
void coding;
