import type { TLRecord, TLStoreSchema, TLStoreSnapshot } from '@tldraw/tlschema';

const shapeTypes = new Set(['arrow', 'draw', 'frame', 'geo', 'group', 'highlight', 'line', 'note', 'text']);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function allowed(record: TLRecord): void {
  if (record.typeName === 'asset') throw new TypeError('Canvas assets require a separately qualified asset adapter');
  if (record.typeName === 'shape' && !shapeTypes.has(record.type)) throw new TypeError('Unsupported canvas shape');
  if (record.typeName === 'binding' && record.type !== 'arrow') throw new TypeError('Unsupported canvas binding');
  if (record.typeName === 'user' && record.imageUrl !== '') throw new TypeError('Canvas author images require a separately qualified asset adapter');
  if (!['document', 'page', 'shape', 'binding', 'user'].includes(record.typeName)) throw new TypeError('Only canvas document records may be published');
}
export function parseCanvasRecords(value: unknown, schema: TLStoreSchema): TLStoreSnapshot {
  if (!object(value) || Object.keys(value).some(key => key !== 'schema' && key !== 'store') || !object(value['schema']) || !object(value['store'])) throw new TypeError('Expected a canvas document snapshot');
  const serialized = schema.serialize(), supplied = value['schema'], sequences = supplied['sequences'];
  if (supplied['schemaVersion'] !== serialized.schemaVersion || !object(sequences)
    || Object.keys(sequences).length !== Object.keys(serialized.sequences).length
    || Object.entries(serialized.sequences).some(([key, version]) => sequences[key] !== version)) throw new TypeError('Canvas schema migration is not qualified');
  const records: TLRecord[] = [];
  for (const [id, item] of Object.entries(value['store'])) {
    if (!object(item)) throw new TypeError('Invalid canvas record');
    const type = Object.values(schema.types).find(candidate => candidate.typeName === item['typeName']);
    if (!type || type.scope !== 'document') throw new TypeError('Canvas snapshots cannot contain unknown or session records');
    const record = type.validate(item);
    if (record.id !== id) throw new TypeError('Canvas record key and identity differ');
    allowed(record); records.push(record);
  }
  return structuredClone({ schema: serialized, store: Object.fromEntries(records.map(record => [record.id, record])) });
}
