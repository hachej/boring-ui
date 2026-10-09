import { randomUUID } from '@hachej/boring-files/platform';

const denied = () => ({ kind: 'denied', reason: 'Draft session is revoked or belongs to another identity' });
const unavailable = () => ({ kind: 'unavailable', reason: 'Draft storage unavailable' });
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const identityKey = identity => canonical(identity);
const branchKey = ref => canonical({ key: ref.key, writerId: ref.writerId });
const request = operation => new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
const complete = transaction => new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error); });

function validateKey(key) {
  if (!key || typeof key !== 'object' || typeof key.providerInstanceId !== 'string' || !key.providerInstanceId || typeof key.format !== 'string' || !key.format) throw new TypeError('Invalid draft binding');
  for (const field of ['principalId', 'scopeId', 'initiatorId']) if (typeof key.identity?.[field] !== 'string' || !key.identity[field]) throw new TypeError('Invalid draft identity');
  if (!key.target?.resource || typeof key.target.resource.providerId !== 'string' || typeof key.target.resource.path !== 'string' || !key.target.resource.providerId || !key.target.resource.path || !['published', 'working'].includes(key.target.view?.kind) || (key.target.view.kind === 'working' && !key.target.view.viewId)) throw new TypeError('Invalid draft target');
}
function validateRef(ref) {
  validateKey(ref?.key);
  if (!Number.isSafeInteger(ref.sequence) || ref.sequence < 1 || typeof ref.writerId !== 'string' || !ref.writerId || !['revision', 'absent'].includes(ref.base?.kind)) throw new TypeError('Invalid draft reference');
  const target = ref.base.target;
  if (canonical({ resource: target?.resource, view: target?.view }) !== canonical(ref.key.target) || (ref.base.kind === 'revision' && (typeof target.revision !== 'string' || !target.revision))) throw new TypeError('Draft base differs from target');
}
function validateDraft(draft, maxBytes) {
  validateRef(draft?.ref);
  if (draft.version !== 1 || typeof draft.text !== 'string' || !Number.isSafeInteger(draft.createdAt) || draft.createdAt < 0 || !Number.isSafeInteger(draft.expiresAt) || draft.expiresAt <= draft.createdAt) throw new TypeError('Invalid draft');
  const bytes = new TextEncoder().encode(draft.text);
  if (bytes.byteLength > maxBytes || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== draft.text) throw new TypeError('Invalid draft text');
}

export async function openDraftDatabase({ indexedDB, name = 'fictional-boring-drafts-v1', now = Date.now, maxBytes = 8 * 1024 * 1024, beforeMutation } = {}) {
  if (!indexedDB || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('IndexedDB and finite draft bounds are required');
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => { const database = opening.result; database.createObjectStore('sessions'); const rows = database.createObjectStore('drafts'); rows.createIndex('document', 'document'); database.createObjectStore('floors'); };
  const database = await request(opening);
  const transact = async (stores, mode, action) => { const transaction = database.transaction(stores, mode); const done = complete(transaction); try { const result = await action(transaction); await done; return result; } catch (error) { try { transaction.abort(); } catch {} await done.catch(() => {}); throw error; } };
  const sessionFor = async (transaction, session, key) => {
    const current = await request(transaction.objectStore('sessions').get(identityKey(session.identity)));
    if (!current?.active || current.epoch !== session.epoch || canonical(key.identity) !== canonical(session.identity)) return denied();
    if (current.expiresAt <= now()) return { kind: 'expired', reason: 'Draft session expired' };
    return null;
  };
  const login = async (identity, retentionMs = 86400000) => {
    validateKey({ identity, providerInstanceId: 'host', format: 'host', target: { resource: { providerId: 'host', path: 'session' }, view: { kind: 'published' } } });
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1) throw new TypeError('Invalid session expiry');
    return transact(['sessions'], 'readwrite', async transaction => {
      const sessions = transaction.objectStore('sessions'), key = identityKey(identity), previous = await request(sessions.get(key));
      const session = previous?.active && previous.expiresAt > now() ? previous : { identity: structuredClone(identity), epoch: randomUUID(), active: true, expiresAt: now() + retentionMs };
      await request(sessions.put(session, key)); return structuredClone(session);
    });
  };
  const logout = async session => transact(['sessions', 'drafts'], 'readwrite', async transaction => {
    const sessions = transaction.objectStore('sessions'), key = identityKey(session.identity), current = await request(sessions.get(key));
    if (current?.epoch !== session.epoch) return;
    await request(sessions.put({ ...current, active: false }, key));
    const rows = transaction.objectStore('drafts');
    const cursorRequest = rows.openCursor();
    await new Promise((resolve, reject) => { cursorRequest.onerror = () => reject(cursorRequest.error); cursorRequest.onsuccess = () => { const cursor = cursorRequest.result; if (!cursor) { resolve(); return; } if (cursor.value.epoch === session.epoch && identityKey(cursor.value.draft.ref.key.identity) === key) cursor.delete(); cursor.continue(); }; });
  });
  const storeFor = session => Object.freeze({
    list: async (key, limit) => {
      try {
        validateKey(key); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid draft list limit');
        return await transact(['sessions', 'drafts'], 'readonly', async transaction => {
          const failure = await sessionFor(transaction, session, key); if (failure) return failure;
          const rows = transaction.objectStore('drafts').index('document'), drafts = []; let truncated = false;
          const cursorRequest = rows.openCursor(canonical(key));
          await new Promise((resolve, reject) => { cursorRequest.onerror = () => reject(cursorRequest.error); cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result; if (!cursor) { resolve(); return; }
            const row = cursor.value;
            if (row.epoch === session.epoch && row.draft.expiresAt > now()) { try { validateDraft(row.draft, maxBytes); } catch (error) { reject(error); return; } if (drafts.length === limit) { truncated = true; resolve(); return; } drafts.push(row.draft); }
            cursor.continue();
          }; });
          return { kind: 'available', drafts, truncated };
        });
      } catch { return unavailable(); }
    },
    write: async input => {
      try {
        const draft = structuredClone(input); validateDraft(draft, maxBytes); await beforeMutation?.('write', draft);
        return await transact(['sessions', 'drafts', 'floors'], 'readwrite', async transaction => {
          const failure = await sessionFor(transaction, session, draft.ref.key); if (failure) return failure;
          if (draft.expiresAt <= now() || draft.expiresAt > session.expiresAt) return { kind: 'expired', reason: 'Draft expiry is outside the active session' };
          const key = branchKey(draft.ref), rows = transaction.objectStore('drafts'), floors = transaction.objectStore('floors'), floor = await request(floors.get(key)) ?? 0, previous = await request(rows.get(key));
          if (draft.ref.sequence <= floor || (previous && previous.draft.ref.sequence > draft.ref.sequence)) return { kind: 'superseded' };
          if (previous?.draft.ref.sequence === draft.ref.sequence) return canonical(previous.draft) === canonical(draft) ? { kind: 'stored' } : { kind: 'denied', reason: 'A stored draft version cannot change' };
          await request(rows.put({ document: canonical(draft.ref.key), epoch: session.epoch, draft }, key)); return { kind: 'stored' };
        });
      } catch { return unavailable(); }
    },
    remove: async input => {
      try {
        const ref = structuredClone(input); validateRef(ref); await beforeMutation?.('remove', ref);
        return await transact(['sessions', 'drafts', 'floors'], 'readwrite', async transaction => {
          const failure = await sessionFor(transaction, session, ref.key); if (failure) return failure;
          const key = branchKey(ref), rows = transaction.objectStore('drafts'), floors = transaction.objectStore('floors'), previous = await request(rows.get(key)), floor = await request(floors.get(key)) ?? 0;
          if (previous?.draft.ref.sequence === ref.sequence && canonical(previous.draft.ref) !== canonical(ref)) return { kind: 'denied', reason: 'Draft removal differs from the stored reference' };
          await request(floors.put(Math.max(floor, ref.sequence), key));
          if (!previous) return { kind: 'missing' };
          if (previous.draft.ref.sequence > ref.sequence) return { kind: 'superseded' };
          await request(rows.delete(key)); return { kind: 'removed' };
        });
      } catch { return unavailable(); }
    },
  });
  return Object.freeze({ login, logout, storeFor, close: () => database.close() });
}
