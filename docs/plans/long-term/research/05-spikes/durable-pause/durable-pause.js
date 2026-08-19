import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digestArgs(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export class DurablePauseStore {
  constructor(path, options = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec(schema);
    this.unsafeSkipAppGuards = options.unsafeSkipAppGuards ?? false;
  }

  close() {
    this.db.close();
  }

  requestPause(input) {
    const pause = {
      pauseId: input.pauseId ?? randomUUID(),
      sessionId: input.sessionId,
      submissionId: input.submissionId,
      toolCallId: input.toolCallId,
      continuationKey: input.continuationKey ?? randomUUID(),
      kind: input.kind,
      actionName: input.actionName,
      canonicalArgs: canonicalize(input.args),
      argsDigest: digestArgs(input.args),
      state: 'pending',
      answerPolicy: JSON.stringify(input.answerPolicy),
      createdAt: input.createdAt ?? Date.now(),
      expiresAt: input.expiresAt,
    };
    this.db.prepare(`
      INSERT INTO pauses (
        pause_id, session_id, submission_id, tool_call_id, continuation_key,
        kind, action_name, canonical_args, args_digest, state, answer_policy,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pause.pauseId, pause.sessionId, pause.submissionId, pause.toolCallId,
      pause.continuationKey, pause.kind, pause.actionName, pause.canonicalArgs,
      pause.argsDigest, pause.state, pause.answerPolicy, pause.createdAt, pause.expiresAt,
    );
    return this.getPause(pause.pauseId);
  }

  getPause(pauseId) {
    return this.db.prepare('SELECT * FROM pauses WHERE pause_id = ?').get(pauseId) ?? null;
  }

  getByContinuationKey(continuationKey) {
    return this.db.prepare('SELECT * FROM pauses WHERE continuation_key = ?').get(continuationKey) ?? null;
  }

  listResponseAttempts(pauseId) {
    return this.db.prepare('SELECT * FROM response_attempts WHERE pause_id = ? ORDER BY attempted_at, attempt_id').all(pauseId);
  }

  answerPause({ pauseId, actionName, args, respondedBy, payload, now = Date.now() }) {
    const pause = this.getPause(pauseId);
    if (!pause) throw new Error('pause not found');
    const argsDigest = digestArgs(args);
    const stale = pause.state !== 'pending' || pause.action_name !== actionName || pause.args_digest !== argsDigest;
    const expired = now >= pause.expires_at;
    const authorized = JSON.parse(pause.answer_policy).includes(respondedBy);

    if (!this.unsafeSkipAppGuards && (stale || expired || !authorized)) {
      this.db.prepare(`
        INSERT INTO response_attempts (
          attempt_id, pause_id, action_name, args_digest, responded_by,
          response_payload, disposition, attempted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'demoted', ?)
      `).run(randomUUID(), pauseId, actionName, argsDigest, respondedBy, JSON.stringify(payload), now);
      if (expired && pause.state === 'pending') {
        this.db.prepare("UPDATE pauses SET state = 'expired' WHERE pause_id = ? AND state = 'pending'").run(pauseId);
      }
      return { disposition: 'demoted', reason: stale ? 'stale' : expired ? 'expired' : 'unauthorized' };
    }

    this.db.prepare(`
      INSERT INTO response_attempts (
        attempt_id, pause_id, action_name, args_digest, responded_by,
        response_payload, disposition, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)
    `).run(randomUUID(), pauseId, actionName, argsDigest, respondedBy, JSON.stringify(payload), now);
    return { disposition: 'accepted' };
  }

  consumePause({ pauseId, toolCallId, continuationKey, now = Date.now() }) {
    const pause = this.getPause(pauseId);
    if (!pause) throw new Error('pause not found');
    if (!this.unsafeSkipAppGuards && pause.state !== 'responded') throw new Error('pause is not responded');
    this.db.prepare(`
      INSERT INTO pause_consumptions (pause_id, tool_call_id, continuation_key, consumed_at)
      VALUES (?, ?, ?, ?)
    `).run(pauseId, toolCallId, continuationKey, now);
    return JSON.parse(pause.response_payload);
  }

  consumptionCount(pauseId) {
    return this.db.prepare('SELECT count(*) AS count FROM pause_consumptions WHERE pause_id = ?').get(pauseId).count;
  }
}

export function requestToolPause(store, input) {
  const pause = store.requestPause(input);
  return {
    status: 'yielded',
    pauseId: pause.pause_id,
    continuationKey: pause.continuation_key,
    toolCallId: pause.tool_call_id,
  };
}

export function resumeToolCall(store, { pauseId, continuationKey, toolCallId }) {
  const answer = store.consumePause({ pauseId, continuationKey, toolCallId });
  return { status: 'completed', toolCallId, continuationKey, answer };
}
