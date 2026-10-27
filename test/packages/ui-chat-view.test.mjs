import assert from 'node:assert/strict';
import test from 'node:test';
import { ASK_USER_TOOL, defaultNoticeText, derive, finishNotice, pendingNotice, preparing, summaryOf, waitingForAnswer, waitingPart, waits } from '@hachej/boring-ui-kit/chat-view';

// The published chat-view subpath: native Pi view → display rows, the waiting rule and the run notices, with fictional fixtures only.
const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'toolUse', timestamp: 1, ...extra });
const user = { id: 1, kind: 'message', model: [{ role: 'user', content: 'Fictional request', timestamp: 0 }] };
const options = { mode: 'expert', renderEntry: undefined, renderTool: undefined, groupTool: undefined };
const ask = { type: 'toolCall', id: 'q', name: ASK_USER_TOOL, arguments: { question: 'Which fictional colour?' } };
const gated = { type: 'toolCall', id: 'g', name: 'delete_all', arguments: { path: 'fictional/x' } };
const approval = decision => ({ 'pi.live': { run: { taskId: 1 }, tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional files?', ...(decision ? { decision } : {}) } } }] } });
const rowsOf = (content, docs = {}) => derive({ entries: [user, { id: 2, kind: 'message', byTaskId: 1, model: [assistant(content)] }], docs }, options).rows;

test('derive turns a native view into user and assistant rows', () => {
  const { rows, run } = derive({ entries: [user, { id: 2, kind: 'message', model: [assistant([{ type: 'text', text: '# Done\nAll fictional.' }], { stopReason: 'stop' })] }], docs: {} }, options);
  assert.deepEqual(rows.map(row => row.type), ['user', 'assistant']);
  assert.equal(run, undefined);
  assert.deepEqual(finishNotice(rows), { kind: 'done', summary: 'Done' });
  assert.deepEqual(derive(undefined, options).rows, []);
});

test('an undecided approval and an unanswered question wait; a decided approval does not', () => {
  const pending = rowsOf([gated], approval());
  assert.equal(waitingForAnswer(pending), true);
  assert.equal(waitingPart(pending)?.kind, 'approval');
  assert.equal(pendingNotice(pending, () => 'unused'), 'Approve: Delete fictional files?');
  for (const decision of ['approved', 'denied', 'cancelled']) {
    const decided = rowsOf([gated], approval(decision));
    const part = decided.flatMap(row => row.type === 'assistant' ? row.parts : []).find(item => item.kind === 'approval');
    assert.equal(part?.decision, decision);
    assert.equal(waits(part), false);
    assert.equal(waitingForAnswer(decided), false, `${decision} is not waiting`);
    assert.equal(pendingNotice(decided, () => 'unused'), undefined);
  }
  const question = rowsOf([ask], { 'pi.live': { run: { taskId: 1 } } });
  assert.equal(waitingPart(question)?.kind, 'question');
  assert.equal(pendingNotice(question, call => call.arguments.question), 'Which fictional colour?');
  assert.equal(pendingNotice(question, () => 'unused', { ...defaultNoticeText, approve: summary => `Approuver : ${summary}` }), 'unused');
  assert.equal(pendingNotice(pending, () => 'unused', { ...defaultNoticeText, approve: summary => `Approuver : ${summary}` }), 'Approuver : Delete fictional files?');
});

test('preparing shows for work, never while waiting or after a confirmed stop', () => {
  const base = { natural: true, waitingForAnswer: false, run: { taskId: 1 }, retry: undefined, compacting: false, stop: 'idle' };
  assert.equal(preparing(base), true);
  assert.equal(preparing({ ...base, natural: false }), false);
  assert.equal(preparing({ ...base, waitingForAnswer: true }), false);
  assert.equal(preparing({ ...base, run: undefined }), false);
  assert.equal(preparing({ ...base, run: undefined, compacting: true }), true);
  assert.equal(preparing({ ...base, run: undefined, retry: {}, stop: 'confirmed' }), false);
});

test('run notices: failure, stop and the one text table', () => {
  const failed = derive({ entries: [user, { id: 2, kind: 'message', model: [assistant([], { stopReason: 'error' })] }], docs: {} }, options).rows;
  assert.deepEqual(finishNotice(failed), { kind: 'error', summary: defaultNoticeText.runFailed });
  assert.deepEqual(finishNotice(failed, { ...defaultNoticeText, runFailed: 'Échec' }), { kind: 'error', summary: 'Échec' });
  const stopped = derive({ entries: [user, { id: 2, kind: 'message', model: [assistant([], { stopReason: 'aborted' })] }], docs: {} }, options).rows;
  assert.equal(finishNotice(stopped), undefined);
  assert.deepEqual(finishNotice([]), { kind: 'done', summary: defaultNoticeText.finished });
  assert.equal(summaryOf('\n## A **fictional** [plan](https://fictional.invalid)\nmore'), 'A fictional plan');
  assert.equal(summaryOf('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
});
