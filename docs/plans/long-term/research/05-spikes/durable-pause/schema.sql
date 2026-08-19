PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS pauses (
  pause_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  continuation_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('approval','question')),
  action_name TEXT NOT NULL,
  canonical_args TEXT NOT NULL CHECK (json_valid(canonical_args)),
  args_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','responded','consumed','denied','expired','cancelled')),
  answer_policy TEXT NOT NULL CHECK (json_valid(answer_policy) AND json_type(answer_policy) = 'array'),
  responded_by TEXT,
  response_payload TEXT CHECK (response_payload IS NULL OR json_valid(response_payload)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS response_attempts (
  attempt_id TEXT PRIMARY KEY,
  pause_id TEXT NOT NULL,
  action_name TEXT NOT NULL,
  args_digest TEXT NOT NULL,
  responded_by TEXT NOT NULL,
  response_payload TEXT NOT NULL CHECK (json_valid(response_payload)),
  disposition TEXT NOT NULL CHECK (disposition IN ('accepted','demoted')),
  attempted_at INTEGER NOT NULL,
  FOREIGN KEY (pause_id) REFERENCES pauses(pause_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS response_attempts_one_accepted_idx
  ON response_attempts(pause_id) WHERE disposition = 'accepted';

CREATE TRIGGER IF NOT EXISTS accepted_response_must_match
BEFORE INSERT ON response_attempts
WHEN NEW.disposition = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM pauses p
    WHERE p.pause_id = NEW.pause_id
      AND p.state = 'pending'
      AND p.action_name = NEW.action_name
      AND p.args_digest = NEW.args_digest
  )
BEGIN SELECT RAISE(ABORT, 'stale or superseded pause'); END;

CREATE TRIGGER IF NOT EXISTS accepted_response_must_be_live
BEFORE INSERT ON response_attempts
WHEN NEW.disposition = 'accepted'
  AND EXISTS (
    SELECT 1 FROM pauses p
    WHERE p.pause_id = NEW.pause_id AND NEW.attempted_at >= p.expires_at
  )
BEGIN SELECT RAISE(ABORT, 'pause expired'); END;

CREATE TRIGGER IF NOT EXISTS accepted_response_must_be_authorized
BEFORE INSERT ON response_attempts
WHEN NEW.disposition = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM pauses p, json_each(p.answer_policy) policy
    WHERE p.pause_id = NEW.pause_id AND policy.value = NEW.responded_by
  )
BEGIN SELECT RAISE(ABORT, 'responder unauthorized'); END;

CREATE TRIGGER IF NOT EXISTS accepted_response_updates_pause
AFTER INSERT ON response_attempts
WHEN NEW.disposition = 'accepted'
BEGIN
  UPDATE pauses
  SET state = 'responded', responded_by = NEW.responded_by, response_payload = NEW.response_payload
  WHERE pause_id = NEW.pause_id;
END;

CREATE TABLE IF NOT EXISTS pause_consumptions (
  pause_id TEXT PRIMARY KEY,
  tool_call_id TEXT NOT NULL,
  continuation_key TEXT NOT NULL,
  consumed_at INTEGER NOT NULL,
  FOREIGN KEY (pause_id) REFERENCES pauses(pause_id)
);

CREATE TRIGGER IF NOT EXISTS consumption_must_match_response
BEFORE INSERT ON pause_consumptions
WHEN NOT EXISTS (
  SELECT 1 FROM pauses p
  WHERE p.pause_id = NEW.pause_id
    AND p.state IN ('responded','consumed')
    AND p.tool_call_id = NEW.tool_call_id
    AND p.continuation_key = NEW.continuation_key
    AND p.response_payload IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'pause is not resumable'); END;

CREATE TRIGGER IF NOT EXISTS consumption_updates_pause
AFTER INSERT ON pause_consumptions
BEGIN
  UPDATE pauses SET state = 'consumed' WHERE pause_id = NEW.pause_id;
END;
