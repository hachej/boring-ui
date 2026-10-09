import { isBindingId, isShapeId, TLDOCUMENT_ID } from '@tldraw/tlschema';
import type { TLBinding, TLRecord, TLShape, TLStoreSchema, TLStoreSnapshot } from '@tldraw/tlschema';
import { parseCanvasRecords } from './canvas-records.js';

export const canvasMediaType = 'application/vnd.tldraw+json';
export type CanvasEditableRecord = TLShape | TLBinding;
/** Updates replace complete native records. Removing a shape also removes its descendants and connected arrows. */
export type CanvasEdit = { readonly kind: 'create' | 'update'; readonly record: CanvasEditableRecord }
  | { readonly kind: 'remove'; readonly id: CanvasEditableRecord['id'] };
export type CanvasEditResult = { readonly kind: 'applied'; readonly document: TLStoreSnapshot }
  | { readonly kind: 'rejected'; readonly reason: string };

/** Parse a complete document without mounting an editor, migrating records or repairing the graph. */
export function parseCanvasDocument(value: unknown, schema: TLStoreSchema): TLStoreSnapshot {
  const document = parseCanvasRecords(value, schema), records = Object.values(document.store);
  const documents = records.filter(record => record.typeName === 'document');
  if (documents.length !== 1 || documents[0]?.id !== TLDOCUMENT_ID || !records.some(record => record.typeName === 'page')) {
    throw new TypeError('Canvas requires its native document record and at least one page');
  }
  const pages = new Map<string, string>();
  function pageOf(shape: TLShape): string {
    const known = pages.get(shape.id);
    if (known !== undefined) return known;
    const visited = new Set<string>();
    let current = shape;
    while (true) {
      const cached = pages.get(current.id);
      if (cached !== undefined) {
        for (const id of visited) pages.set(id, cached);
        return cached;
      }
      if (visited.has(current.id)) throw new TypeError('Canvas shape parents contain a cycle');
      visited.add(current.id);
      const parent = document.store[current.parentId];
      if (parent?.typeName === 'page') {
        for (const id of visited) pages.set(id, parent.id);
        return parent.id;
      }
      if (parent?.typeName !== 'shape' || (parent.type !== 'group' && parent.type !== 'frame')) {
        throw new TypeError('Canvas shape parent must be an existing page, group or frame');
      }
      current = parent;
    }
  }
  for (const record of records) if (record.typeName === 'shape') pageOf(record);
  const terminals = new Set<string>();
  for (const record of records) {
    if (record.typeName !== 'binding') continue;
    const from = document.store[record.fromId], to = document.store[record.toId];
    if (from?.typeName !== 'shape' || from.type !== 'arrow' || to?.typeName !== 'shape' || to.type === 'arrow') {
      throw new TypeError('Canvas arrow binding must connect an existing arrow to a non-arrow shape');
    }
    if (pageOf(from) !== pageOf(to)) throw new TypeError('Canvas arrow binding cannot cross pages');
    const terminal = JSON.stringify([record.fromId, record.props['terminal']]);
    if (terminals.has(terminal)) throw new TypeError('Canvas arrow has duplicate terminal bindings');
    terminals.add(terminal);
  }
  return document;
}

/** Parse edit inputs with the selected native schema, without changing a document. */
export function parseCanvasEdits(value: unknown, schema: TLStoreSchema): readonly CanvasEdit[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Canvas edits must be a nonempty array');
  const edits: CanvasEdit[] = [], requested = new Set<string>();
  for (const item of structuredClone(value)) {
    const edit: unknown = item;
    if (!edit || typeof edit !== 'object' || !('kind' in edit)) throw new TypeError('Invalid canvas edit');
    let parsed: CanvasEdit;
    if (edit.kind === 'remove') {
      if (Object.keys(edit).some(key => key !== 'kind' && key !== 'id') || !('id' in edit) || typeof edit.id !== 'string'
        || (!isShapeId(edit.id) && !isBindingId(edit.id))) throw new TypeError('Invalid canvas removal');
      parsed = { kind: 'remove', id: edit.id };
    } else if (edit.kind === 'create' || edit.kind === 'update') {
      if (Object.keys(edit).some(key => key !== 'kind' && key !== 'record') || !('record' in edit) || !edit.record || typeof edit.record !== 'object'
        || !('typeName' in edit.record)) throw new TypeError('Invalid canvas edit record');
      const record = edit.record.typeName === 'shape' ? schema.types.shape.validate(edit.record)
        : edit.record.typeName === 'binding' ? schema.types.binding.validate(edit.record) : undefined;
      if (!record || (record.typeName !== 'shape' && record.typeName !== 'binding')) throw new TypeError('Canvas edits accept only shapes and bindings');
      parsed = { kind: edit.kind, record };
    } else throw new TypeError('Unknown canvas edit kind');
    const id = parsed.kind === 'remove' ? parsed.id : parsed.record.id;
    if (requested.has(id)) throw new TypeError('Canvas batch edits an identity more than once');
    requested.add(id); edits.push(parsed);
  }
  return edits;
}

/** Apply one atomic edit batch to a detached candidate. The caller owns conditional publication. */
export function applyCanvasEdits(document: TLStoreSnapshot, edits: readonly CanvasEdit[], schema: TLStoreSchema): CanvasEditResult {
  try {
    const candidate = parseCanvasDocument(document, schema);
    const removed = new Set<TLRecord['id']>(), written = new Set<string>();
    for (const edit of parseCanvasEdits(edits, schema)) {
      if (edit.kind === 'remove') {
        const current = candidate.store[edit.id];
        if (current?.typeName !== 'shape' && current?.typeName !== 'binding') throw new TypeError('Canvas removal requires an existing shape or binding');
        removed.add(edit.id);
      } else {
        const record = edit.record, current = candidate.store[record.id];
        if (edit.kind === 'create' ? current !== undefined : current?.typeName !== record.typeName || !('type' in current) || current.type !== record.type) {
          throw new TypeError('Canvas create requires absence; update requires an existing record of the same type');
        }
        written.add(record.id); candidate.store[record.id] = record;
      }
    }
    const records = Object.values(candidate.store);
    let previousSize = -1;
    while (removed.size !== previousSize) {
      previousSize = removed.size;
      for (const record of records) {
        if (record.typeName === 'shape' && removed.has(record.parentId)) removed.add(record.id);
        if (record.typeName === 'binding' && !removed.has(record.id) && removed.has(record.toId)) removed.add(record.fromId);
      }
    }
    for (const record of records) if (record.typeName === 'binding' && (removed.has(record.fromId) || removed.has(record.toId))) removed.add(record.id);
    for (const id of removed) {
      if (written.has(id)) throw new TypeError('Canvas batch writes a record removed by its deletion cascade');
      delete candidate.store[id];
    }
    return { kind: 'applied', document: parseCanvasDocument(candidate, schema) };
  } catch (error) {
    return { kind: 'rejected', reason: error instanceof Error ? error.message : 'Invalid canvas edit batch' };
  }
}
