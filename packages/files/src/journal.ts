import type { CommittedChange, NonEmpty, ResourceRef } from './contracts.js';
import { registerJournalConnection } from './sqlite-batch.js';
import type { SqliteConnection } from './sqlite.js';

/**
 * Operation tables of the workspace journal: who asked for which operation, the digest of
 * its arguments, its evidence reference and the changes it committed. Rows are plain strings; callers turn them into references.
 * Every method is synchronous and runs in the caller's transaction (open one with `connection.transaction`), except the methods
 * of `WorkspaceJournal` that say they commit on their own.
 */
export interface OperationKey {
  readonly scope: string;
  readonly principal: string;
  readonly initiator: string;
  readonly operation: string;
}

export interface StoredChange {
  readonly kind: 'create' | 'replace' | 'delete';
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface StoredOperation {
  readonly digest: string;
  readonly evidence: string;
  readonly changes: readonly StoredChange[];
}

export interface OperationJournal {
  /** Create the operation tables when missing. */
  readonly install: () => void;
  readonly operation: (key: OperationKey) => StoredOperation | undefined;
  readonly record: (key: OperationKey, operation: StoredOperation) => void;
}

const keyValues = (key: OperationKey): [string, string, string, string] => [key.scope, key.principal, key.initiator, key.operation];

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored journal value');
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

export function createOperationJournal(db: SqliteConnection): OperationJournal {
  return {
    install: () => db.exec(`
      CREATE TABLE IF NOT EXISTS boring_operations (
        scope TEXT NOT NULL, principal TEXT NOT NULL, initiator TEXT NOT NULL, operation TEXT NOT NULL,
        digest TEXT NOT NULL, evidence TEXT NOT NULL,
        PRIMARY KEY (scope, principal, initiator, operation)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS boring_changes (
        scope TEXT NOT NULL, principal TEXT NOT NULL, initiator TEXT NOT NULL, operation TEXT NOT NULL,
        ordinal INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
        before_revision TEXT, after_revision TEXT,
        PRIMARY KEY (scope, principal, initiator, operation, ordinal)
      ) STRICT;
    `),
    operation: key => {
      const values = keyValues(key);
      const row = db.get('SELECT digest, evidence FROM boring_operations WHERE scope = ? AND principal = ? AND initiator = ? AND operation = ?', ...values);
      if (!row) return undefined;
      const changes = db.all('SELECT * FROM boring_changes WHERE scope = ? AND principal = ? AND initiator = ? AND operation = ? ORDER BY ordinal', ...values).map((item): StoredChange => {
        const kind = text(item.kind);
        if (kind !== 'create' && kind !== 'replace' && kind !== 'delete') throw new Error('Invalid stored publication change');
        return { kind, path: text(item.path), before: nullableText(item.before_revision), after: nullableText(item.after_revision) };
      });
      return { digest: text(row.digest), evidence: text(row.evidence), changes };
    },
    record: (key, operation) => {
      const values = keyValues(key);
      db.run('INSERT INTO boring_operations VALUES (?, ?, ?, ?, ?, ?)', ...values, operation.digest, operation.evidence);
      operation.changes.forEach((item, index) => db.run('INSERT INTO boring_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ...values, index, item.path, item.kind, item.before, item.after));
    },
  };
}

/** Stored rows as committed changes, with the same shape checks the receipt parser applies. */
export function committedChanges(changes: readonly StoredChange[], ref: (path: string, revision: string) => ResourceRef): NonEmpty<CommittedChange> {
  const mapped = changes.map((item): CommittedChange => {
    if (item.kind === 'create' && item.before === null && item.after !== null) return { kind: 'create', before: null, after: ref(item.path, item.after) };
    if (item.kind === 'delete' && item.after === null && item.before !== null) return { kind: 'delete', before: ref(item.path, item.before), after: null };
    if (item.kind === 'replace' && item.before !== null && item.after !== null) return { kind: 'replace', before: ref(item.path, item.before), after: ref(item.path, item.after) };
    throw new Error('Invalid stored publication change');
  });
  const [first, ...rest] = mapped;
  if (first === undefined) throw new Error('Stored operation has no changes');
  return [first, ...rest];
}

export interface StoredVersion {
  readonly revision: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  /** When this revision was saved, in milliseconds since the epoch. Kept the first time the revision is retained. */
  readonly savedAt?: number;
  /**
   * Who produced the revision: `publish` (a conditional write), `agent` (a Pi `write` or `edit`, recorded by `provider.record`: it
   * has no receipt) or `observed` (retained as found: `keep`, or the replaced revision of a write). Default `publish`.
   */
  readonly source?: HistorySource;
}

export type HistorySource = 'publish' | 'agent' | 'observed';
const historySource = (value: unknown): HistorySource => value === 'agent' || value === 'observed' ? value : 'publish';

/**
 * The operation journal plus what a workspace needs beyond receipts: an intent row written before an operation's first effect
 * (an intent without a completion is an operation of unknown outcome), and the last versions of each file when there is no Git.
 * Receipts and intents are scoped per operation key; history is scoped per `scope` argument and path.
 */
export interface WorkspaceJournal extends OperationJournal {
  /** The intent of an operation that has begun and neither completed nor been cancelled. */
  readonly intent: (key: OperationKey) => { readonly digest: string } | undefined;
  /** Commits on its own. */
  readonly begin: (key: OperationKey, digest: string) => void;
  /** Commits on its own: the operation is known not to have taken effect. */
  readonly cancel: (key: OperationKey) => void;
  /** Commits on its own: the receipt, the end of the intent and the new versions together. */
  readonly complete: (key: OperationKey, operation: StoredOperation, versions: { readonly scope: string; readonly path: string; readonly version: StoredVersion }[]) => void;
  /** Commits on its own. Keeps the newest `historyLimit` revisions of the file. */
  readonly remember: (scope: string, path: string, version: StoredVersion) => void;
  readonly version: (scope: string, path: string, revision: string) => StoredVersion | undefined;
  /** Retained revisions of a file, newest first. */
  readonly revisions: (scope: string, path: string) => string[];
  /** Retained revisions of a file with their save times, newest first. A time of 0 is unknown (kept before times were recorded). */
  readonly saves: (scope: string, path: string) => { readonly revision: string; readonly savedAt: number; readonly source: HistorySource }[];
}

export function createWorkspaceJournal(db: SqliteConnection, options: { readonly historyLimit?: number } = {}): WorkspaceJournal {
  const limit = options.historyLimit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('The history limit must be a positive integer');
  const operations = createOperationJournal(db);
  db.transaction('write', () => {
    operations.install();
    db.exec(`
      CREATE TABLE IF NOT EXISTS boring_intents (
        scope TEXT NOT NULL, principal TEXT NOT NULL, initiator TEXT NOT NULL, operation TEXT NOT NULL,
        digest TEXT NOT NULL,
        PRIMARY KEY (scope, principal, initiator, operation)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS boring_history (
        scope TEXT NOT NULL, path TEXT NOT NULL, revision TEXT NOT NULL, sequence INTEGER NOT NULL,
        bytes BLOB NOT NULL, media_type TEXT NOT NULL, saved_at INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'publish',
        PRIMARY KEY (scope, path, revision)
      ) STRICT;
    `);
    // A journal created before save times were recorded gets the column; its old rows read as unknown (0).
    if (!db.all("SELECT name FROM pragma_table_info('boring_history')").some(column => column.name === 'saved_at')) db.exec('ALTER TABLE boring_history ADD COLUMN saved_at INTEGER NOT NULL DEFAULT 0');
    // A journal created before history recorded who wrote each revision: its old rows were all conditional writes.
    if (!db.all("SELECT name FROM pragma_table_info('boring_history')").some(column => column.name === 'source')) db.exec("ALTER TABLE boring_history ADD COLUMN source TEXT NOT NULL DEFAULT 'publish'");
  });
  const remember = (scope: string, path: string, version: StoredVersion): void => {
    const last = db.get('SELECT COALESCE(MAX(sequence), 0) AS last FROM boring_history WHERE scope = ? AND path = ?', scope, path);
    const sequence = Number(last?.last ?? 0) + 1;
    // A revision found again (`observed`) keeps the writer it was first recorded with; a new write of the same bytes names its writer.
    db.run("INSERT INTO boring_history (scope, path, revision, sequence, bytes, media_type, saved_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope, path, revision) DO UPDATE SET sequence = excluded.sequence, bytes = excluded.bytes, media_type = excluded.media_type, saved_at = CASE WHEN boring_history.saved_at = 0 THEN excluded.saved_at ELSE boring_history.saved_at END, source = CASE WHEN excluded.source = 'observed' THEN boring_history.source ELSE excluded.source END",
      scope, path, version.revision, sequence, version.bytes, version.mediaType, version.savedAt ?? 0, historySource(version.source));
    db.run('DELETE FROM boring_history WHERE scope = ? AND path = ? AND revision NOT IN (SELECT revision FROM boring_history WHERE scope = ? AND path = ? ORDER BY sequence DESC LIMIT ?)', scope, path, scope, path, limit);
  };
  const journal: WorkspaceJournal = {
    ...operations,
    intent: key => {
      const row = db.get('SELECT digest FROM boring_intents WHERE scope = ? AND principal = ? AND initiator = ? AND operation = ?', ...keyValues(key));
      return row ? { digest: text(row.digest) } : undefined;
    },
    begin: (key, digest) => db.transaction('write', () => { db.run('INSERT INTO boring_intents VALUES (?, ?, ?, ?, ?)', ...keyValues(key), digest); }),
    cancel: key => db.transaction('write', () => { db.run('DELETE FROM boring_intents WHERE scope = ? AND principal = ? AND initiator = ? AND operation = ?', ...keyValues(key)); }),
    complete: (key, operation, versions) => db.transaction('write', () => {
      operations.record(key, operation);
      db.run('DELETE FROM boring_intents WHERE scope = ? AND principal = ? AND initiator = ? AND operation = ?', ...keyValues(key));
      for (const item of versions) remember(item.scope, item.path, item.version);
    }),
    remember: (scope, path, version) => db.transaction('write', () => { remember(scope, path, version); }),
    version: (scope, path, revision) => {
      const row = db.get('SELECT bytes, media_type FROM boring_history WHERE scope = ? AND path = ? AND revision = ?', scope, path, revision);
      if (!row) return undefined;
      if (!(row.bytes instanceof Uint8Array)) throw new Error('Invalid stored bytes');
      return { revision, bytes: Uint8Array.from(row.bytes), mediaType: text(row.media_type) };
    },
    revisions: (scope, path) => db.all('SELECT revision FROM boring_history WHERE scope = ? AND path = ? ORDER BY sequence DESC', scope, path).map(row => text(row.revision)),
    saves: (scope, path) => db.all('SELECT revision, saved_at, source FROM boring_history WHERE scope = ? AND path = ? ORDER BY sequence DESC', scope, path).map(row => ({ revision: text(row.revision), savedAt: Number(row.saved_at), source: historySource(row.source) })),
  };
  registerJournalConnection(journal, db);
  return journal;
}
