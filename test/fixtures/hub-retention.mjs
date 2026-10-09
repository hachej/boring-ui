import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const markersFrom = (value, prefix = '') => Object.entries(value).flatMap(([key, nested]) => {
  const name = prefix ? `${prefix}.${key}` : key;
  return typeof nested === 'string' ? [[name, nested]] : markersFrom(nested, name);
});

async function pages(scan) {
  const records = [], cursors = new Set();
  let cursor;
  do {
    const page = await scan(cursor);
    if (page.items.length > 100) throw new Error('Native retention scan exceeded its page bound');
    records.push(...page.items);
    cursor = page.next;
    if (cursor !== undefined) {
      const key = JSON.stringify(cursor);
      if (cursors.has(key)) throw new Error('Native retention scan repeated a cursor');
      cursors.add(key);
    }
  } while (cursor !== undefined);
  return records;
}

async function nativeSurfaces(storage, label) {
  const conversations = await pages(cursor => storage.scanConversations({}, 100, cursor, context));
  const tasks = await pages(cursor => storage.scanTasks({}, 100, cursor, context));
  const submissions = await pages(cursor => storage.scanSubmissions({}, 100, cursor, context));
  const records = [
    [`${label}:conversations`, conversations], [`${label}:tasks`, tasks], [`${label}:submissions`, submissions],
  ];
  for (const conversation of conversations) records.push([`${label}:entries:${conversation.id}`,
    await pages(cursor => storage.scanEntries({ conversationId: conversation.id }, 100, cursor, context))]);
  const scopes = [{ kind: 'session' }, ...conversations.map(value => ({ kind: 'conversation', conversationId: value.id })),
    ...tasks.map(value => ({ kind: 'task', taskId: value.id }))];
  for (const scope of scopes) {
    const documents = await pages(cursor => storage.scanDocuments({ scope, at: 'current' }, 100, cursor, context));
    records.push([`${label}:documents:${JSON.stringify(scope)}`, documents]);
    for (const document of documents) records.push([`${label}:document:${document.id}`, await storage.document(document.id, 'current', context)]);
  }
  return records.map(([name, value]) => [name, Buffer.from(JSON.stringify(value))]);
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function scanHubRetention({ storages, directories = [], captures = [], markers }) {
  const surfaces = [];
  for (const [label, storage] of Object.entries(storages)) surfaces.push(...await nativeSurfaces(storage, label));
  for (const [index, capture] of captures.entries()) surfaces.push([`capture:${index}`, Buffer.from(JSON.stringify(capture))]);
  for (const directory of directories) for (const path of await filesUnder(directory)) surfaces.push([`file:${path}`, await readFile(path)]);
  const hits = [];
  for (const [name, value] of markersFrom(markers)) {
    const literal = Buffer.from(value, 'utf8');
    if (!literal.length) throw new TypeError('Private marker must be nonempty');
    for (const [surface, bytes] of surfaces) if (bytes.includes(literal)) hits.push({ marker: name, surface });
  }
  return { hits, surfaces: surfaces.map(([name]) => name) };
}
