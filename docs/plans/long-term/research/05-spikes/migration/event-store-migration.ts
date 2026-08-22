import { DatabaseSync } from "node:sqlite";
import { appendCanonicalRecords } from "./canonical-session-storage.ts";
import type { DurableRecordStore } from "../../spike-l0-schema/src/store.ts";

export const LEGACY_EVENT_SCHEMA = `
CREATE TABLE boring_event_streams (
  path TEXT PRIMARY KEY,
  next_offset INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1))
);
CREATE TABLE boring_event_stream_entries (
  path TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT,
  PRIMARY KEY (path, seq)
);
CREATE TABLE boring_event_stream_keys (
  path TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (path, idempotency_key),
  UNIQUE (path, seq)
);`;

export function createLegacyEventFixture(db: DatabaseSync) {
  db.exec(LEGACY_EVENT_SCHEMA);
  const append = (path: string, sessionId: string, chunk: unknown, key: string) => {
    db.prepare("INSERT OR IGNORE INTO boring_event_streams(path) VALUES (?)").run(path);
    const row = db.prepare(`UPDATE boring_event_streams SET next_offset=next_offset+1
      WHERE path=? AND closed=0 RETURNING next_offset-1 AS seq`).get(path) as { seq: number };
    const envelope = { v: 1, eventIndex: row.seq, timestamp: 1_700_000_000_000 + row.seq, sessionId, chunk };
    db.prepare("INSERT INTO boring_event_stream_entries(path,seq,data) VALUES (?,?,?)")
      .run(path, row.seq, JSON.stringify(envelope));
    db.prepare("INSERT INTO boring_event_stream_keys(path,idempotency_key,seq,data) VALUES (?,?,?,?)")
      .run(path, key, row.seq, JSON.stringify(chunk));
  };
  append("sessions/legacy-session", "legacy-session", { type: "agent-start", seq: 0 }, "0");
  append('sessions/["scoped-session","workspace-a","user-a"]', "scoped-session", { type: "agent-start", seq: 0 }, "0");
}

export type DecodedEventPath = {
  sessionId: string;
  workspaceId?: string;
  userId?: string;
  tenantId?: string;
};

export function decodeEventPath(path: string): DecodedEventPath {
  if (!path.startsWith("sessions/")) throw new Error(`not a session stream path: ${path}`);
  const key = path.slice("sessions/".length);
  if (key.startsWith("[")) {
    const decoded = JSON.parse(key) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 3 || !decoded.every((item) => typeof item === "string")) {
      throw new Error(`malformed serialized session key: ${path}`);
    }
    return { sessionId: decoded[0], workspaceId: decoded[1] || undefined, userId: decoded[2] || undefined };
  }
  return { sessionId: key };
}

export function planEventPromotion(db: DatabaseSync, path: string, tenantResolver?: (decoded: DecodedEventPath) => string | undefined) {
  const decoded = decodeEventPath(path);
  const tenantId = tenantResolver?.(decoded);
  if (!tenantId) {
    throw new Error(`cannot promote ${path}: tenant_id is absent from the legacy key and no authoritative mapping was supplied`);
  }
  if (!decoded.workspaceId) {
    throw new Error(`cannot promote ${path}: workspace_id is absent from the legacy key`);
  }
  const rows = db.prepare("SELECT seq,data FROM boring_event_stream_entries WHERE path=? ORDER BY seq").all(path);
  return { ...decoded, tenantId, rows };
}

export function promoteEventPath(
  store: DurableRecordStore,
  db: DatabaseSync,
  path: string,
  tenantResolver?: (decoded: DecodedEventPath) => string | undefined,
) {
  const plan = planEventPromotion(db, path, tenantResolver);
  store.createSession({
    sessionId: plan.sessionId,
    instanceUid: `legacy-event-stream:${plan.sessionId}`,
    agentType: "pi",
  });
  const records = (plan.rows as Array<{ seq: number; data: string }>).map((row) => ({
    recordId: `legacy-event:${row.seq}`,
    kind: "legacy_pi_chat_event",
    payload: { sourcePath: path, sourceSeq: row.seq, envelope: JSON.parse(row.data) },
  }));
  appendCanonicalRecords(store, { sessionId: plan.sessionId, purpose: "legacy-event-import", records });
  return { sessionId: plan.sessionId, promotedRecordCount: records.length };
}
