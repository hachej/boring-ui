import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { accessSnapshot, locator, parsePublicationResult, publicationDigest } from '@hachej/boring-files/publication';
import { applyTaskListOperations, emptyTaskList, readTaskList, serializeTaskList, taskListMediaType } from '../../registry/task-list-viewer/task-list-document.ts';

const intentKey = 'fictional.task-list.intent.v1', attemptedKey = 'fictional.task-list.attempted.v1';
const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const unknown = (intent, reason) => ({ kind: 'unknown', operationId: intent.operationId, reason });
const id = Type.String({ minLength: 1, maxLength: 128 });
const title = Type.String({ minLength: 1, maxLength: 2048 });
const operation = Type.Union([
  Type.Object({ kind: Type.Literal('add'), id, title }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('rename'), id, title }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('set-completed'), id, completed: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('remove'), id }, { additionalProperties: false }),
]);

export function createTaskListTools({ namespace, resolve }) {
  if (typeof namespace !== 'string' || !namespace || typeof resolve !== 'function') throw new TypeError('Task-list tools need a namespace and host resolver');
  async function bind(api, context) {
    const value = await resolve(api, context);
    if (!value || typeof value.bindingId !== 'string' || !value.bindingId) throw new TypeError('The original workspace binding is unavailable');
    const target = locator(value.target), access = accessSnapshot(value.access);
    if (target.view.kind !== 'published') throw new TypeError('Task-list tools require a published resource');
    return { ...value, target, access, binding: { namespace, bindingId: value.bindingId, target,
      principalId: access.principalId, scopeId: access.scopeId, initiatorId: access.initiatorId, authorizationRef: access.authorizationRef ?? null } };
  }
  const sameResource = (ref, target) => ref?.resource.providerId === target.resource.providerId && ref.resource.path === target.resource.path && ref.view.kind === 'published';
  async function read(bound) {
    const result = await bound.reader.read({ target: structuredClone(bound.target), revision: { kind: 'latest' } }, bound.access);
    if (result.kind !== 'available') return result;
    if (!sameResource(result.snapshot.ref, bound.target) || result.snapshot.mediaType !== taskListMediaType) return { kind: 'unavailable', reason: 'Read returned another resource or media type' };
    try { return { kind: 'available', revision: result.snapshot.ref.revision, document: readTaskList(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.snapshot.bytes)) }; }
    catch { return { kind: 'unavailable', reason: 'The saved task list is invalid' }; }
  }
  async function publish(bound, intent, api, context) {
    if (intent.version !== 1 || JSON.stringify(bound.binding) !== JSON.stringify(intent.binding)) return unknown(intent, 'Task-list binding or identity changed; reconcile under the original binding');
    const target = intent.binding.target;
    const bytes = new TextEncoder().encode(intent.text);
    const request = { operationId: intent.operationId, atomicity: 'all-or-nothing', changes: [intent.revision === null
      ? { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: taskListMediaType }
      : { kind: 'replace', target: { ...target, revision: intent.revision }, bytes, mediaType: taskListMediaType }] };
    const digest = await publicationDigest(request);
    const uncertain = () => unknown(intent, 'Task-list publication could not be confirmed; look up this operation before another edit');
    function evidence(value) {
      let result;
      try { result = parsePublicationResult(value); } catch { return uncertain(); }
      if (result.kind === 'unknown' || result.kind === 'partial') return uncertain();
      if (result.kind !== 'committed') return result;
      const receipt = result.receipt, change = receipt.changes[0];
      if (receipt.operationId !== intent.operationId || receipt.argumentDigest !== digest || receipt.principalId !== intent.binding.principalId
        || receipt.scopeId !== intent.binding.scopeId || receipt.initiatorId !== intent.binding.initiatorId || receipt.changes.length !== 1
        || !sameResource(change.after, target) || (intent.revision === null ? change.kind !== 'create' || change.before !== null
          : change.kind !== 'replace' || !sameResource(change.before, target) || change.before.revision !== intent.revision)) return uncertain();
      return result;
    }
    async function lookup() {
      try { const result = evidence(await bound.lookup.lookup(intent.operationId, bound.access)); return result.kind === 'committed' ? result : uncertain(); }
      catch { return uncertain(); }
    }
    let result;
    if (await api.memo(attemptedKey, context)) result = await lookup();
    else {
      await api.memo(attemptedKey, true, context);
      try { result = evidence(await bound.publisher.publish(structuredClone(request), bound.access)); }
      catch { result = uncertain(); }
      if (result.kind === 'unknown') result = await lookup();
    }
    return result.kind === 'committed' ? { kind: 'saved', revision: result.receipt.changes[0].after.revision, document: readTaskList(intent.text), receipt: result.receipt } : result;
  }
  return [
    defineTool({ name: 'read_task_list', description: 'Read the saved task list and its exact revision. A missing list can be created with an absent expectation.', parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe',
      execute: async (_args, api, context) => {
        try { return reply(await read(await bind(api, context))); }
        catch { return reply({ kind: 'denied', reason: 'Task-list access could not be resolved' }); }
      },
    }),
    defineTool({ name: 'edit_task_list', description: 'Apply task operations to the exact saved revision you read, or create an absent task list. Does not edit an open browser draft.',
      parameters: Type.Object({ expected: Type.Union([Type.Object({ kind: Type.Literal('absent') }, { additionalProperties: false }),
        Type.Object({ kind: Type.Literal('revision'), revision: Type.String({ minLength: 1 }) }, { additionalProperties: false })]), operations: Type.Array(operation, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }), replay: 'safe',
      execute: async (args, api, context) => {
        const retained = await api.memo(intentKey, context);
        let bound;
        try { bound = await bind(api, context); }
        catch { return reply(retained ? unknown(retained, 'The original task-list binding or access is unavailable') : { kind: 'denied', reason: 'Task-list access could not be resolved' }); }
        if (retained) return reply(await publish(bound, retained, api, context));
        const current = await read(bound);
        if (current.kind !== 'available' && current.kind !== 'missing') return reply(current);
        if (args.expected.kind === 'absent' ? current.kind !== 'missing' : current.kind !== 'available' || current.revision !== args.expected.revision) {
          return reply({ kind: 'conflict', reason: 'The saved task list no longer matches the expected revision; read it again' });
        }
        let document;
        try { document = applyTaskListOperations(current.kind === 'missing' ? emptyTaskList() : current.document, args.operations); }
        catch { return reply({ kind: 'denied', reason: 'Task-list operations are invalid or conflict with the saved list' }); }
        const intent = await api.memo(intentKey, { version: 1, operationId: JSON.stringify([namespace, api.taskId]), binding: bound.binding,
          revision: current.kind === 'missing' ? null : current.revision, text: serializeTaskList(document) }, context);
        return reply(await publish(bound, intent, api, context));
      },
    }),
  ];
}
