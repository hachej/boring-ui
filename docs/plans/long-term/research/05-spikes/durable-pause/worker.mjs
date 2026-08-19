import { DurablePauseStore, requestToolPause, resumeToolCall } from './durable-pause.js';
import { readFileSync } from 'node:fs';

const [mode, dbPath, pauseId, continuationKey, toolCallId] = process.argv.slice(2);
const store = new DurablePauseStore(dbPath);
const actionName = 'deploy.release';
const args = { environment: 'production', version: '2026.08.11' };

if (mode === 'request') {
  const yielded = requestToolPause(store, {
    sessionId: 'session-1',
    submissionId: 'submission-1',
    toolCallId: 'tool-call-1',
    kind: 'approval',
    actionName,
    args,
    answerPolicy: ['reviewer-1'],
    expiresAt: Date.now() + 60_000,
  });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...yielded })}\n`);
  // The interval belongs only to the kill-test harness. No unresolved answer Promise exists.
  setInterval(() => {}, 1_000);
} else if (mode === 'answer-resume') {
  const answered = store.answerPause({
    pauseId,
    actionName,
    args,
    respondedBy: 'reviewer-1',
    payload: { approved: true, note: 'ship it' },
  });
  const completed = resumeToolCall(store, { pauseId, continuationKey, toolCallId });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, answered, completed })}\n`);
  store.close();
} else if (mode === 'answer-resume-file') {
  const request = JSON.parse(readFileSync(pauseId, 'utf8'));
  const answered = store.answerPause({
    pauseId: request.pauseId,
    actionName,
    args,
    respondedBy: 'reviewer-1',
    payload: { approved: true, note: 'ship it' },
  });
  const completed = resumeToolCall(store, {
    pauseId: request.pauseId,
    continuationKey: request.continuationKey,
    toolCallId: request.toolCallId,
  });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, killedWith: 'SIGKILL', answered, completed })}\n`);
  store.close();
} else {
  throw new Error(`unknown worker mode: ${mode}`);
}
