PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS agent_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO agent_store_meta(key, value) VALUES ('physical_schema_version', '1');

CREATE TABLE IF NOT EXISTS agent_sessions (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  instance_uid TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  next_queue_seq INTEGER NOT NULL DEFAULT 0 CHECK (next_queue_seq >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, session_id),
  UNIQUE (tenant_id, workspace_id, instance_uid)
);

CREATE TABLE IF NOT EXISTS conversation_streams (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  incarnation_uid TEXT NOT NULL,
  head_batch_no INTEGER NOT NULL DEFAULT -1 CHECK (head_batch_no >= -1),
  producer_id TEXT,
  producer_epoch INTEGER CHECK (producer_epoch IS NULL OR producer_epoch >= 0),
  producer_submission_id TEXT,
  producer_attempt_id TEXT,
  next_producer_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_producer_sequence >= 0),
  PRIMARY KEY (tenant_id, workspace_id, stream_id),
  UNIQUE (tenant_id, workspace_id, session_id),
  UNIQUE (tenant_id, workspace_id, stream_id, session_id),
  FOREIGN KEY (tenant_id, workspace_id, session_id)
    REFERENCES agent_sessions(tenant_id, workspace_id, session_id),
  CHECK ((producer_submission_id IS NULL) = (producer_attempt_id IS NULL)),
  CHECK ((producer_id IS NULL) = (producer_attempt_id IS NULL))
);

CREATE TABLE IF NOT EXISTS submissions (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  queue_seq INTEGER NOT NULL CHECK (queue_seq >= 0),
  agent_type TEXT NOT NULL,
  payload_version INTEGER NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  payload_digest TEXT NOT NULL,
  idempotency_key TEXT,
  origin TEXT NOT NULL,
  admitted_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','terminalizing','settled')),
  current_attempt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  timeout_at INTEGER,
  abort_requested_at INTEGER,
  abort_requested_by_principal_id TEXT,
  abort_reason TEXT,
  reserved_settlement_record_id TEXT,
  settlement_record_id TEXT,
  settlement_outcome TEXT CHECK (settlement_outcome IS NULL OR settlement_outcome IN ('completed','failed','aborted')),
  settlement_payload_digest TEXT,
  terminalizing_at INTEGER,
  settled_at INTEGER,
  PRIMARY KEY (tenant_id, workspace_id, submission_id),
  UNIQUE (tenant_id, workspace_id, session_id, queue_seq),
  UNIQUE (tenant_id, workspace_id, session_id, submission_id),
  FOREIGN KEY (tenant_id, workspace_id, session_id)
    REFERENCES agent_sessions(tenant_id, workspace_id, session_id),
  CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
  CHECK (
    (status = 'queued' AND current_attempt_id IS NULL AND reserved_settlement_record_id IS NULL
      AND settlement_record_id IS NULL AND settlement_outcome IS NULL AND settled_at IS NULL)
    OR
    (status = 'running' AND current_attempt_id IS NOT NULL AND reserved_settlement_record_id IS NULL
      AND settlement_record_id IS NULL AND settlement_outcome IS NULL AND settled_at IS NULL)
    OR
    (status = 'terminalizing' AND current_attempt_id IS NOT NULL AND reserved_settlement_record_id IS NOT NULL
      AND settlement_record_id IS NULL AND settlement_outcome IS NOT NULL
      AND settlement_payload_digest IS NOT NULL AND terminalizing_at IS NOT NULL AND settled_at IS NULL)
    OR
    (status = 'settled' AND current_attempt_id IS NOT NULL AND reserved_settlement_record_id IS NOT NULL
      AND settlement_record_id = reserved_settlement_record_id AND settlement_outcome IS NOT NULL
      AND settlement_payload_digest IS NOT NULL AND settled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS submissions_idempotency_present_idx
  ON submissions(tenant_id, workspace_id, session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS submissions_unsettled_head_idx
  ON submissions(tenant_id, workspace_id, session_id, queue_seq)
  WHERE status <> 'settled';

CREATE TABLE IF NOT EXISTS admission_outbox (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  request_key_digest TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('committed','projected')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, request_key_digest),
  FOREIGN KEY (tenant_id, workspace_id, session_id, submission_id)
    REFERENCES submissions(tenant_id, workspace_id, session_id, submission_id)
);

CREATE TABLE IF NOT EXISTS submission_attempts (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  state TEXT NOT NULL CHECK (state IN ('running','replaced','finished')),
  owner_id TEXT NOT NULL,
  owner_epoch INTEGER NOT NULL CHECK (owner_epoch >= 0),
  lease_expires_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  replaced_by_attempt_id TEXT,
  PRIMARY KEY (tenant_id, workspace_id, attempt_id),
  UNIQUE (tenant_id, workspace_id, submission_id, attempt_no),
  UNIQUE (tenant_id, workspace_id, session_id, submission_id, attempt_id),
  FOREIGN KEY (tenant_id, workspace_id, session_id, submission_id)
    REFERENCES submissions(tenant_id, workspace_id, session_id, submission_id),
  FOREIGN KEY (tenant_id, workspace_id, replaced_by_attempt_id)
    REFERENCES submission_attempts(tenant_id, workspace_id, attempt_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (state = 'running' AND finished_at IS NULL AND replaced_by_attempt_id IS NULL)
    OR (state = 'replaced' AND finished_at IS NOT NULL AND replaced_by_attempt_id IS NOT NULL)
    OR (state = 'finished' AND finished_at IS NOT NULL AND replaced_by_attempt_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS submission_attempts_one_running_idx
  ON submission_attempts(tenant_id, workspace_id, submission_id) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS submission_attempts_expired_idx
  ON submission_attempts(tenant_id, workspace_id, lease_expires_at) WHERE state = 'running';

CREATE TABLE IF NOT EXISTS stream_batches (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  incarnation_uid TEXT NOT NULL,
  batch_no INTEGER NOT NULL CHECK (batch_no >= 0),
  producer_id TEXT NOT NULL,
  producer_epoch INTEGER NOT NULL CHECK (producer_epoch >= 0),
  producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 0),
  submission_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count > 0),
  content_digest TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0,1)),
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, stream_id, batch_no),
  UNIQUE (tenant_id, workspace_id, stream_id, producer_id, producer_epoch, producer_sequence),
  FOREIGN KEY (tenant_id, workspace_id, stream_id, session_id)
    REFERENCES conversation_streams(tenant_id, workspace_id, stream_id, session_id),
  FOREIGN KEY (tenant_id, workspace_id, session_id, submission_id, attempt_id)
    REFERENCES submission_attempts(tenant_id, workspace_id, session_id, submission_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS stream_records (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  batch_no INTEGER NOT NULL,
  record_index INTEGER NOT NULL CHECK (record_index >= 0),
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (record_schema_version > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  payload_digest TEXT,
  submission_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, stream_id, batch_no, record_index),
  UNIQUE (tenant_id, workspace_id, stream_id, record_id),
  UNIQUE (tenant_id, workspace_id, session_id, record_id),
  UNIQUE (tenant_id, workspace_id, stream_id, session_id, record_id),
  FOREIGN KEY (tenant_id, workspace_id, stream_id, batch_no)
    REFERENCES stream_batches(tenant_id, workspace_id, stream_id, batch_no),
  FOREIGN KEY (tenant_id, workspace_id, stream_id, session_id)
    REFERENCES conversation_streams(tenant_id, workspace_id, stream_id, session_id),
  FOREIGN KEY (tenant_id, workspace_id, session_id, submission_id, attempt_id)
    REFERENCES submission_attempts(tenant_id, workspace_id, session_id, submission_id, attempt_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS stream_records_one_settlement_idx
  ON stream_records(tenant_id, workspace_id, submission_id) WHERE kind = 'submission_settled';

CREATE TRIGGER IF NOT EXISTS stream_batches_must_start_incomplete
BEFORE INSERT ON stream_batches WHEN NEW.complete <> 0
BEGIN SELECT RAISE(ABORT, 'batch must start incomplete'); END;

CREATE TRIGGER IF NOT EXISTS stream_batches_validate_producer_fence
BEFORE INSERT ON stream_batches
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM conversation_streams cs
    JOIN submissions s
      ON s.tenant_id=cs.tenant_id AND s.workspace_id=cs.workspace_id
      AND s.session_id=cs.session_id AND s.submission_id=NEW.submission_id
    JOIN submission_attempts a
      ON a.tenant_id=s.tenant_id AND a.workspace_id=s.workspace_id
      AND a.session_id=s.session_id AND a.submission_id=s.submission_id
      AND a.attempt_id=NEW.attempt_id
    WHERE cs.tenant_id=NEW.tenant_id AND cs.workspace_id=NEW.workspace_id
      AND cs.stream_id=NEW.stream_id AND cs.session_id=NEW.session_id
      AND cs.incarnation_uid=NEW.incarnation_uid
      AND NEW.batch_no=cs.head_batch_no + 1
      AND NEW.producer_sequence=cs.next_producer_sequence
      AND s.status IN ('running','terminalizing')
      AND s.current_attempt_id=NEW.attempt_id
      AND a.state='running' AND a.owner_id=NEW.producer_id
      AND a.owner_epoch=NEW.producer_epoch AND a.lease_expires_at>NEW.committed_at
      AND cs.producer_id=NEW.producer_id AND cs.producer_epoch=NEW.producer_epoch
      AND cs.producer_submission_id=NEW.submission_id
      AND cs.producer_attempt_id=NEW.attempt_id
  ) THEN RAISE(ABORT, 'producer fenced: batch is not current, owned, and live') END;
END;

CREATE TRIGGER IF NOT EXISTS stream_batches_validate_completion
BEFORE UPDATE OF complete ON stream_batches
WHEN OLD.complete = 0 AND NEW.complete = 1
BEGIN
  SELECT CASE WHEN (
    SELECT count(*) FROM stream_records r
    WHERE r.tenant_id = NEW.tenant_id AND r.workspace_id = NEW.workspace_id
      AND r.stream_id = NEW.stream_id AND r.batch_no = NEW.batch_no
  ) <> NEW.record_count THEN RAISE(ABORT, 'batch record_count mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS stream_batches_immutable
BEFORE UPDATE ON stream_batches WHEN OLD.complete = 1
BEGIN SELECT RAISE(ABORT, 'completed batch is immutable'); END;
CREATE TRIGGER IF NOT EXISTS stream_batches_no_delete
BEFORE DELETE ON stream_batches
BEGIN SELECT RAISE(ABORT, 'batch is immutable'); END;
CREATE TRIGGER IF NOT EXISTS stream_records_no_update
BEFORE UPDATE ON stream_records
BEGIN SELECT RAISE(ABORT, 'record is immutable'); END;
CREATE TRIGGER IF NOT EXISTS stream_records_no_delete
BEFORE DELETE ON stream_records
BEGIN SELECT RAISE(ABORT, 'record is immutable'); END;
CREATE TRIGGER IF NOT EXISTS stream_records_no_insert_into_completed_batch
BEFORE INSERT ON stream_records
WHEN EXISTS (
  SELECT 1 FROM stream_batches b
  WHERE b.tenant_id=NEW.tenant_id AND b.workspace_id=NEW.workspace_id
    AND b.stream_id=NEW.stream_id AND b.batch_no=NEW.batch_no AND b.complete=1
)
BEGIN SELECT RAISE(ABORT, 'completed batch is immutable'); END;

CREATE TRIGGER IF NOT EXISTS stream_records_settlement_must_be_reserved
BEFORE INSERT ON stream_records WHEN NEW.kind = 'submission_settled'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM submissions s
    WHERE s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id
      AND s.session_id=NEW.session_id AND s.submission_id=NEW.submission_id
      AND s.current_attempt_id=NEW.attempt_id AND s.status='terminalizing'
      AND s.reserved_settlement_record_id=NEW.record_id
      AND s.settlement_payload_digest=NEW.payload_digest
      AND s.settlement_outcome=json_extract(NEW.payload, '$.outcome')
  ) THEN RAISE(ABORT, 'settlement record is not reserved') END;
END;

CREATE TRIGGER IF NOT EXISTS submissions_validate_settlement
BEFORE UPDATE OF status ON submissions WHEN NEW.status = 'settled'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stream_records r
    WHERE r.tenant_id = NEW.tenant_id AND r.workspace_id = NEW.workspace_id
      AND r.session_id = NEW.session_id AND r.record_id = NEW.settlement_record_id
      AND r.submission_id = NEW.submission_id AND r.attempt_id = NEW.current_attempt_id
      AND r.kind = 'submission_settled' AND r.payload_digest = NEW.settlement_payload_digest
      AND json_extract(r.payload, '$.outcome') = NEW.settlement_outcome
  ) THEN RAISE(ABORT, 'settlement record does not match reservation') END;
END;

CREATE TRIGGER IF NOT EXISTS submissions_must_start_queued
BEFORE INSERT ON submissions WHEN NEW.status <> 'queued'
BEGIN SELECT RAISE(ABORT, 'submission must start queued'); END;

CREATE TRIGGER IF NOT EXISTS submissions_validate_status_transition
BEFORE UPDATE OF status ON submissions
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status='queued' AND NEW.status='running')
  OR (OLD.status='running' AND NEW.status='terminalizing')
  OR (OLD.status='terminalizing' AND NEW.status='settled')
)
BEGIN SELECT RAISE(ABORT, 'invalid submission status transition'); END;

CREATE INDEX IF NOT EXISTS submissions_terminalizing_recovery_idx
  ON submissions(tenant_id, workspace_id, terminalizing_at) WHERE status = 'terminalizing';
