import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { accessSnapshot, identifier, locator, reference } from '@hachej/boring-files/publication';

const canonicalKey = key => JSON.stringify({ identity: accessSnapshot(key.identity), providerInstanceId: identifier(key.providerInstanceId), target: locator(key.target), format: identifier(key.format) });
const canonicalRef = ref => ({ key: JSON.parse(canonicalKey(ref.key)), base: ref.base.kind === 'absent' ? { kind: 'absent', target: locator(ref.base.target) } : ref.base.kind === 'revision' ? { kind: 'revision', target: reference(ref.base.target) } : null, writerId: identifier(ref.writerId), sequence: ref.sequence });

export function openTextDraftSqlite({ filename, identity, providerInstanceId = 'fictional-instance', sessionId = 'fictional-session', expiresAt = Date.now() + 86_400_000, now = Date.now }) {
  const db = openNodeConnection(filename), abort = new AbortController();
  const principal = JSON.stringify(accessSnapshot(identity));
  identifier(sessionId); identifier(providerInstanceId);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new TypeError('Invalid session expiry');
  db.exec(`CREATE TABLE IF NOT EXISTS draft_sessions (id TEXT PRIMARY KEY, principal TEXT NOT NULL, provider TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS draft_slots (session TEXT NOT NULL, key TEXT NOT NULL, writer TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, floor INTEGER NOT NULL DEFAULT 0, payload TEXT, expires INTEGER, PRIMARY KEY(session,key,writer));`);
  db.transaction('write', () => {
    const previous = db.get('SELECT * FROM draft_sessions WHERE id=?', sessionId);
    if (previous && (previous.principal !== principal || previous.provider !== providerInstanceId)) throw new Error('Session belongs to a different principal or provider');
    if (!previous) db.run('INSERT INTO draft_sessions(id,principal,provider,expires) VALUES(?,?,?,?)', sessionId, principal, providerInstanceId, expiresAt);
    else expiresAt = previous.expires;
  });
  function allowed(key) {
    const session = db.get('SELECT * FROM draft_sessions WHERE id=?', sessionId);
    if (!session || session.revoked || JSON.stringify(accessSnapshot(key.identity)) !== principal || key.providerInstanceId !== providerInstanceId) return { kind: 'denied', reason: 'Draft session is revoked or outside this authenticated scope' };
    if (session.expires <= now()) return { kind: 'expired', reason: 'Draft session expired' };
  }
  function parsedRef(value) {
    const ref = canonicalRef(value);
    if (!ref.base || JSON.stringify(locator(ref.base.target)) !== JSON.stringify(ref.key.target) || !Number.isSafeInteger(ref.sequence) || ref.sequence < 1) throw new TypeError('Invalid draft reference');
    return ref;
  }
  const store = {
    list: async (key, limit) => db.transaction('read', () => {
      const denied = allowed(key); if (denied) return denied;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('Invalid draft listing limit');
      const rows = db.all('SELECT payload FROM draft_slots WHERE session=? AND key=? AND payload IS NOT NULL AND expires>? ORDER BY writer LIMIT ?', sessionId, canonicalKey(key), now(), limit + 1);
      return { kind: 'available', drafts: rows.slice(0, limit).map(row => JSON.parse(row.payload)), truncated: rows.length > limit };
    }),
    write: async value => db.transaction('write', () => {
      const ref = parsedRef(value.ref), denied = allowed(ref.key); if (denied) return denied;
      if (value.version !== 1 || typeof value.text !== 'string' || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.createdAt || value.expiresAt > expiresAt) throw new TypeError('Invalid draft envelope');
      const bytes = new TextEncoder().encode(value.text);
      if (bytes.length > 8 * 1024 * 1024 || new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== value.text) throw new TypeError('Invalid draft text');
      if (value.expiresAt <= now()) return { kind: 'expired', reason: 'Draft expired' };
      const key = canonicalKey(ref.key), payload = JSON.stringify({ version: 1, ref, text: value.text, createdAt: value.createdAt, expiresAt: value.expiresAt });
      const row = db.get('SELECT * FROM draft_slots WHERE session=? AND key=? AND writer=?', sessionId, key, ref.writerId);
      if (row && (ref.sequence <= row.floor || ref.sequence < row.sequence)) return { kind: 'superseded' };
      if (row && ref.sequence === row.sequence) return row.payload === payload ? { kind: 'stored' } : { kind: 'denied', reason: 'Draft version was reused with different content' };
      db.run('INSERT INTO draft_slots(session,key,writer,sequence,payload,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(session,key,writer) DO UPDATE SET sequence=excluded.sequence,payload=excluded.payload,expires=excluded.expires', sessionId, key, ref.writerId, ref.sequence, payload, value.expiresAt);
      return { kind: 'stored' };
    }),
    remove: async value => db.transaction('write', () => {
      const ref = parsedRef(value), denied = allowed(ref.key); if (denied) return denied;
      const key = canonicalKey(ref.key), row = db.get('SELECT * FROM draft_slots WHERE session=? AND key=? AND writer=?', sessionId, key, ref.writerId);
      if (row?.payload && row.sequence === ref.sequence && JSON.stringify(JSON.parse(row.payload).ref) !== JSON.stringify(ref)) return { kind: 'denied', reason: 'Removal does not match the stored version' };
      db.run('INSERT INTO draft_slots(session,key,writer,floor) VALUES(?,?,?,?) ON CONFLICT(session,key,writer) DO UPDATE SET floor=MAX(floor,excluded.floor)', sessionId, key, ref.writerId, ref.sequence);
      if (row && row.sequence > ref.sequence) return { kind: 'superseded' };
      db.run('UPDATE draft_slots SET payload=NULL,expires=NULL WHERE session=? AND key=? AND writer=? AND sequence<=?', sessionId, key, ref.writerId, ref.sequence);
      return { kind: row?.payload ? 'removed' : 'missing' };
    }),
  };
  return { store, signal: abort.signal, expiresAt,
    revoke: async () => {
      abort.abort();
      db.transaction('write', () => {
        db.run('UPDATE draft_sessions SET revoked=1 WHERE id=?', sessionId);
        db.run('DELETE FROM draft_slots WHERE session=?', sessionId);
      });
    },
    close: () => db.close(),
  };
}
