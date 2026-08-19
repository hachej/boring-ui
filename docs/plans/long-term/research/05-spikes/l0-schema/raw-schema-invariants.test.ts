import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { databasePath } from './helpers.js';

const schema = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
const tenant = 'tenant-a';
const workspace = 'workspace-a';

function openRaw(): DatabaseSync {
  const db = new DatabaseSync(databasePath());
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(schema);
  return db;
}

function seedRunning(db: DatabaseSync, input: {
  sessionId?: string; submissionId?: string; attemptId?: string;
  ownerId?: string; ownerEpoch?: number;
} = {}) {
  const sessionId = input.sessionId ?? 'session-1';
  const submissionId = input.submissionId ?? 'submission-1';
  const attemptId = input.attemptId ?? 'attempt-1';
  const ownerId = input.ownerId ?? 'worker-a';
  const ownerEpoch = input.ownerEpoch ?? 7;
  const streamId = `stream:${sessionId}`;

  db.prepare(`INSERT INTO agent_sessions
    (tenant_id, workspace_id, session_id, instance_uid, agent_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pi', 1000, 1000)`).run(
    tenant, workspace, sessionId, `instance:${sessionId}`,
  );
  db.prepare(`INSERT INTO conversation_streams
    (tenant_id, workspace_id, stream_id, session_id, incarnation_uid)
    VALUES (?, ?, ?, ?, ?)`).run(
    tenant, workspace, streamId, sessionId, `incarnation:${sessionId}`,
  );
  db.prepare(`INSERT INTO submissions
    (tenant_id, workspace_id, session_id, submission_id, queue_seq, agent_type,
     payload, payload_digest, origin, admitted_at)
    VALUES (?, ?, ?, ?, 0, 'pi', '{}', 'payload', 'raw-test', 1000)`).run(
    tenant, workspace, sessionId, submissionId,
  );
  db.prepare(`INSERT INTO submission_attempts
    (tenant_id, workspace_id, session_id, attempt_id, submission_id, attempt_no,
     state, owner_id, owner_epoch, lease_expires_at, started_at)
    VALUES (?, ?, ?, ?, ?, 1, 'running', ?, ?, 2000, 1000)`).run(
    tenant, workspace, sessionId, attemptId, submissionId, ownerId, ownerEpoch,
  );
  db.prepare(`UPDATE submissions SET status='running', current_attempt_id=?, attempt_count=1
    WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(
    attemptId, tenant, workspace, submissionId,
  );
  db.prepare(`UPDATE conversation_streams SET producer_id=?, producer_epoch=?,
      producer_submission_id=?, producer_attempt_id=?
    WHERE tenant_id=? AND workspace_id=? AND stream_id=?`).run(
    ownerId, ownerEpoch, submissionId, attemptId, tenant, workspace, streamId,
  );
  return { sessionId, streamId, submissionId, attemptId, ownerId, ownerEpoch };
}

function insertBatch(db: DatabaseSync, fixture: ReturnType<typeof seedRunning>, input: {
  batchNo?: number; producerSequence?: number; recordCount?: number; complete?: number;
  attemptId?: string; ownerId?: string; ownerEpoch?: number; committedAt?: number;
} = {}) {
  return db.prepare(`INSERT INTO stream_batches
    (tenant_id, workspace_id, stream_id, session_id, incarnation_uid, batch_no,
     producer_id, producer_epoch, producer_sequence, submission_id, attempt_id,
     record_count, content_digest, complete, committed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw-batch', ?, ?)`).run(
    tenant, workspace, fixture.streamId, fixture.sessionId, `incarnation:${fixture.sessionId}`,
    input.batchNo ?? 0, input.ownerId ?? fixture.ownerId, input.ownerEpoch ?? fixture.ownerEpoch,
    input.producerSequence ?? 0, fixture.submissionId, input.attemptId ?? fixture.attemptId,
    input.recordCount ?? 1, input.complete ?? 0, input.committedAt ?? 1050,
  );
}

function insertRecord(db: DatabaseSync, fixture: ReturnType<typeof seedRunning>, input: {
  batchNo?: number; recordIndex?: number; recordId?: string; kind?: string;
  payload?: string; payloadDigest?: string | null; sessionId?: string;
  submissionId?: string; attemptId?: string;
} = {}) {
  return db.prepare(`INSERT INTO stream_records
    (tenant_id, workspace_id, stream_id, session_id, batch_no, record_index, record_id,
     kind, payload, payload_digest, submission_id, attempt_id, committed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1050)`).run(
    tenant, workspace, fixture.streamId, input.sessionId ?? fixture.sessionId,
    input.batchNo ?? 0, input.recordIndex ?? 0, input.recordId ?? 'record-1',
    input.kind ?? 'assistant_delta', input.payload ?? '{}', input.payloadDigest ?? null,
    input.submissionId ?? fixture.submissionId, input.attemptId ?? fixture.attemptId,
  );
}

describe('raw SQL structural invariants', () => {
  it('rejects two running attempts for one submission', () => {
    const db = openRaw();
    const f = seedRunning(db);
    expect(() => db.prepare(`INSERT INTO submission_attempts
      (tenant_id, workspace_id, session_id, attempt_id, submission_id, attempt_no,
       state, owner_id, owner_epoch, lease_expires_at, started_at)
      VALUES (?, ?, ?, 'attempt-2', ?, 2, 'running', 'worker-b', 8, 2100, 1100)`).run(
      tenant, workspace, f.sessionId, f.submissionId,
    )).toThrow(/UNIQUE constraint failed/i);
    db.close();
  });

  it('rejects two settlement records for one submission', () => {
    const db = openRaw();
    const f = seedRunning(db);
    db.prepare(`UPDATE submissions SET status='terminalizing',
      reserved_settlement_record_id='settlement-1', settlement_outcome='completed',
      settlement_payload_digest='digest-1', terminalizing_at=1050
      WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(tenant, workspace, f.submissionId);
    insertBatch(db, f, { recordCount: 2 });
    insertRecord(db, f, { recordId: 'settlement-1', kind: 'submission_settled',
      payload: '{"outcome":"completed"}', payloadDigest: 'digest-1' });
    db.prepare(`UPDATE submissions SET reserved_settlement_record_id='settlement-2',
      settlement_outcome='failed', settlement_payload_digest='digest-2'
      WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(tenant, workspace, f.submissionId);
    expect(() => insertRecord(db, f, { recordIndex: 1, recordId: 'settlement-2',
      kind: 'submission_settled', payload: '{"outcome":"failed"}', payloadDigest: 'digest-2' }))
      .toThrow(/UNIQUE constraint failed/i);
    db.close();
  });

  it('rejects a record appended into an already-complete batch', () => {
    const db = openRaw();
    const f = seedRunning(db);
    insertBatch(db, f);
    insertRecord(db, f);
    db.prepare(`UPDATE stream_batches SET complete=1
      WHERE tenant_id=? AND workspace_id=? AND stream_id=? AND batch_no=0`)
      .run(tenant, workspace, f.streamId);
    expect(() => insertRecord(db, f, { recordIndex: 1, recordId: 'record-2' }))
      .toThrow(/completed batch is immutable/i);
    db.close();
  });

  it('rejects every route to a complete batch whose child count does not match', () => {
    const db = openRaw();
    const f = seedRunning(db);
    expect(() => insertBatch(db, f, { recordCount: 2, complete: 1 }))
      .toThrow(/must start incomplete/i);
    insertBatch(db, f, { recordCount: 2 });
    insertRecord(db, f);
    expect(() => db.prepare(`UPDATE stream_batches SET complete=1
      WHERE tenant_id=? AND workspace_id=? AND stream_id=? AND batch_no=0`)
      .run(tenant, workspace, f.streamId)).toThrow(/record_count mismatch/i);
    db.close();
  });

  it('rejects a fenced producer appending a legally-shaped row', () => {
    const db = openRaw();
    const f = seedRunning(db);
    db.exec('BEGIN');
    db.prepare(`UPDATE submission_attempts SET state='replaced', finished_at=1100,
      replaced_by_attempt_id='attempt-2' WHERE tenant_id=? AND workspace_id=? AND attempt_id=?`)
      .run(tenant, workspace, f.attemptId);
    db.prepare(`INSERT INTO submission_attempts
      (tenant_id, workspace_id, session_id, attempt_id, submission_id, attempt_no,
       state, owner_id, owner_epoch, lease_expires_at, started_at)
      VALUES (?, ?, ?, 'attempt-2', ?, 2, 'running', 'worker-b', 8, 2200, 1100)`).run(
      tenant, workspace, f.sessionId, f.submissionId,
    );
    db.prepare(`UPDATE submissions SET current_attempt_id='attempt-2', attempt_count=2
      WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(tenant, workspace, f.submissionId);
    db.prepare(`UPDATE conversation_streams SET producer_id='worker-b', producer_epoch=8,
      producer_attempt_id='attempt-2' WHERE tenant_id=? AND workspace_id=? AND stream_id=?`)
      .run(tenant, workspace, f.streamId);
    db.exec('COMMIT');
    expect(() => insertBatch(db, f)).toThrow(/producer fenced/i);
    db.close();
  });

  it('rejects a submission reaching a second terminal outcome', () => {
    const db = openRaw();
    const f = seedRunning(db);
    db.prepare(`UPDATE submissions SET status='terminalizing',
      reserved_settlement_record_id='settlement-1', settlement_outcome='completed',
      settlement_payload_digest='digest-1', terminalizing_at=1050
      WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(tenant, workspace, f.submissionId);
    insertBatch(db, f);
    insertRecord(db, f, { recordId: 'settlement-1', kind: 'submission_settled',
      payload: '{"outcome":"completed"}', payloadDigest: 'digest-1' });
    db.prepare(`UPDATE stream_batches SET complete=1
      WHERE tenant_id=? AND workspace_id=? AND stream_id=? AND batch_no=0`)
      .run(tenant, workspace, f.streamId);
    db.prepare(`UPDATE submissions SET status='settled', settlement_record_id='settlement-1', settled_at=1050
      WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(tenant, workspace, f.submissionId);
    expect(() => db.prepare(`UPDATE submissions SET status='terminalizing',
      reserved_settlement_record_id='settlement-2', settlement_record_id=NULL,
      settlement_outcome='failed', settlement_payload_digest='digest-2', settled_at=NULL
      WHERE tenant_id=? AND workspace_id=? AND submission_id=?`).run(tenant, workspace, f.submissionId))
      .toThrow(/invalid submission status transition/i);
    db.close();
  });

  it('rejects a stream record with an inconsistent session/stream/tenant triple', () => {
    const db = openRaw();
    const first = seedRunning(db);
    const second = seedRunning(db, { sessionId: 'session-2', submissionId: 'submission-2',
      attemptId: 'attempt-2', ownerId: 'worker-b', ownerEpoch: 8 });
    insertBatch(db, first);
    expect(() => insertRecord(db, first, { sessionId: second.sessionId,
      submissionId: second.submissionId, attemptId: second.attemptId }))
      .toThrow(/FOREIGN KEY constraint failed/i);
    db.close();
  });
});
