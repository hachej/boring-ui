import { z } from 'zod';
import { createTextBuffer } from '@hachej/boring-ui-kit/text-buffer';
import type { TextBufferOptions, TextBufferState } from '@hachej/boring-ui-kit/text-buffer';
import type { EditableViewerController, SaveSelection, SaveResult } from '@hachej/boring-ui-kit/resources';
import type { PresentationCommand, ViewerFeature } from '@hachej/boring-ui-kit/contracts';
import type { ReadResult, ResourceExpectation, ResourceLocator } from '@hachej/boring-files';
import { applyTaskListOperations, emptyTaskList, readTaskList, serializeTaskList, taskListKind, taskListMediaType, taskListVersion } from './task-list-document';
import type { TaskListDocument, TaskListOperation } from './task-list-document';

export interface TaskListState extends TextBufferState { readonly document: TaskListDocument }
export type TaskListOptions = Pick<TextBufferOptions, 'identity' | 'instanceId' | 'epoch' | 'source' | 'client' | 'readOnly' | 'onListenerError'>;
type EditResult = { readonly kind: 'applied' } | { readonly kind: 'stale' | 'conflict' | 'denied' | 'unavailable'; readonly reason: string };
export interface TaskListActions {
  readonly selection: () => SaveSelection;
  readonly edit: (selection: SaveSelection, operations: readonly TaskListOperation[]) => EditResult;
  readonly refresh: () => Promise<ReadResult>;
  readonly discardToRemote: () => Promise<ReadResult>;
  readonly reconcile: () => Promise<SaveResult>;
  readonly abandon: () => Promise<ReadResult>;
}
export interface TaskListTools {
  readonly inspect: PresentationCommand<{ readonly expiresAt: number }, {
    readonly document: TaskListDocument; readonly dirty: boolean; readonly bufferVersion: number; readonly base: ResourceExpectation;
  }, SaveSelection['target']['subject']>;
}
export type TaskListController = EditableViewerController<TaskListState, TaskListActions, TaskListTools>;
const expiry = z.object({ expiresAt: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) }).strict();
const locator = z.object({ resource: z.object({ providerId: z.string().min(1).max(256), path: z.string().min(1).max(2048) }).strict(), view: z.object({ kind: z.literal('published') }).strict() }).strict();
const descriptorSchema = z.object({ kind: z.literal(taskListKind), version: z.literal(taskListVersion), title: z.string().max(2048).optional(), source: locator }).strict();
export interface TaskListDescriptor { readonly kind: typeof taskListKind; readonly version: typeof taskListVersion; readonly title?: string; readonly source: ResourceLocator }

function sameBase(left: ResourceExpectation, right: ResourceExpectation): boolean {
  return left.kind === right.kind && left.target.resource.providerId === right.target.resource.providerId && left.target.resource.path === right.target.resource.path
    && left.target.view.kind === right.target.view.kind && (left.target.view.kind === 'published' || right.target.view.kind === 'working' && left.target.view.viewId === right.target.view.viewId)
    && (left.kind === 'absent' || right.kind === 'revision' && left.target.revision === right.target.revision);
}

export function createTaskListController(options: TaskListOptions): TaskListController {
  locator.parse(options.source.kind === 'saved'
    ? { resource: options.source.snapshot.ref.resource, view: options.source.snapshot.ref.view } : options.source.target);
  const source = options.source.kind === 'saved' ? options.source : { ...options.source, text: options.source.text ?? serializeTaskList(emptyTaskList()) };
  if (source.kind === 'new') readTaskList(source.text);
  const buffer = createTextBuffer({ ...options, source, emptyText: serializeTaskList(emptyTaskList()), mediaType: taskListMediaType, readText: snapshot => {
    if (snapshot.mediaType !== taskListMediaType) throw new TypeError('Expected a task-list document');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
    readTaskList(text); return text;
  } });
  let state: TaskListState = Object.freeze({ ...buffer.getSnapshot(), document: readTaskList(buffer.getSnapshot().text) });
  const unsubscribe = buffer.subscribe(() => {
    const next = buffer.getSnapshot();
    state = Object.freeze({ ...next, document: next.text === state.text ? state.document : readTaskList(next.text) });
  });
  const selected = (selection: SaveSelection) => {
    const current = buffer.selection().target, proposed = selection.target;
    return proposed.instanceId === current.instanceId && proposed.epoch === current.epoch && proposed.subject.scopeId === current.subject.scopeId
      && proposed.subject.bufferVersion === current.subject.bufferVersion && sameBase(proposed.subject.base, current.subject.base);
  };
  return {
    getSnapshot: () => state, subscribe: buffer.subscribe, flush: buffer.flush,
    dispose: () => { buffer.dispose(); unsubscribe(); },
    actions: {
      selection: buffer.selection,
      edit: (selection, operations) => {
        if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
        if (state.readOnly) return { kind: 'denied', reason: 'Viewer is read-only' };
        if (!selected(selection)) return { kind: 'stale', reason: 'Task-list target has changed' };
        let document;
        try { document = applyTaskListOperations(state.document, operations); }
        catch { return { kind: 'conflict', reason: 'Task-list operations are invalid or conflict with the current list' }; }
        buffer.edit(serializeTaskList(document));
        return { kind: 'applied' };
      },
      refresh: () => buffer.refresh(false), discardToRemote: () => buffer.refresh(true), reconcile: buffer.reconcile, abandon: buffer.abandon,
    },
    tools: { inspect: { name: 'inspect_task_list_buffer', input: { jsonSchema: z.toJSONSchema(expiry), parse: value => expiry.parse(value) }, invoke: async (target, input, signal) => {
      if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
      if (signal?.aborted) return { kind: 'denied', reason: 'Inspection cancelled' };
      if (expiry.parse(input).expiresAt <= Date.now() || !selected({ target })) return { kind: 'stale', reason: 'Inspection target changed or expired' };
      return { kind: 'applied', value: { document: state.document, dirty: state.dirty, bufferVersion: state.bufferVersion, base: state.base } };
    } } },
  };
}

export function createTaskListFeature(options: TaskListOptions): ViewerFeature<TaskListDescriptor, TaskListController> {
  const captured = { ...options, identity: structuredClone(options.identity), source: structuredClone(options.source) };
  const configured = locator.parse(captured.source.kind === 'saved'
    ? { resource: captured.source.snapshot.ref.resource, view: captured.source.snapshot.ref.view } : captured.source.target);
  return { kind: taskListKind, version: taskListVersion,
    descriptor: { jsonSchema: z.toJSONSchema(descriptorSchema), parse: value => {
      const parsed = descriptorSchema.parse(value);
      return { kind: parsed.kind, version: parsed.version, source: parsed.source, ...(parsed.title === undefined ? {} : { title: parsed.title }) };
    } },
    createController: descriptor => {
      const parsed = descriptorSchema.parse(descriptor);
      if (JSON.stringify(parsed.source) !== JSON.stringify(configured)) throw new TypeError('Descriptor names another task-list source');
      return createTaskListController(captured);
    },
  };
}
