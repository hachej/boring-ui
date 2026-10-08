import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createCorrectnessFixture } from '../../examples/studio/correctness-fixture.mjs';

test('browser correctness fixture drives two repeated-ID questions through the real native Harness', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-correctness-smoke-'));
  const resources = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
  const fixture = createCorrectnessFixture();
  const host = { resources, context, agentAccess: { scopeId: 'fictional-project', principalId: 'fictional-agent', initiatorId: 'fictional-person' },
    target: path => ({ resource: { providerId: 'documents', path }, view: { kind: 'published' } }) };
  let harness, watch;
  try {
    const demo = await fixture.demo(host), registry = createRegistry(); demo.agent.install(registry);
    harness = await Harness.open(new MemoryStorage(), { registry, models: fixture.models }, context);
    const conversation = await demo.agent.createConversation(harness, context);
    watch = await conversation.watch(context); watch.start(async () => {});
    const submission = await conversation.submit({ type: 'input', requestId: 'fictional-gate', content: 'Plan a fictional picnic.' }, context);
    const until = async check => { const deadline = Date.now() + 5000; while (!await check()) { assert.ok(Date.now() < deadline, 'fixture progressed'); await new Promise(resolve => setTimeout(resolve, 10)); } };
    for (const [prompt, answer] of [['Where do we picnic?', 'park'], ['Which color?', 'red']]) {
      let entry;
      await until(() => (entry = watch.value.entries.find(item => item.model?.some(message => message.role === 'assistant'
        && message.content.some(part => part.type === 'toolCall' && part.arguments.question === prompt)))));
      const id = JSON.stringify([entry.id, 'reused-fictional-call']);
      await until(async () => {
        const outcome = await demo.answer(conversation, id, answer);
        assert.ok(outcome.kind === 'answered' || outcome.kind === 'unknown-question');
        return outcome.kind === 'answered';
      });
    }
    assert.equal((await submission.wait(context)).status, 'done');
    assert.equal(fixture.transcripts.length, 3);
    assert.deepEqual(fixture.transcripts.at(-1).messages.filter(message => message.role === 'toolResult').map(message => JSON.parse(message.content[0].text).answer), ['park', 'red']);
    const seeded = await resources.read({ target: fixture.target, revision: { kind: 'latest' } }, host.agentAccess);
    assert.equal(seeded.kind, 'available'); assert.equal(new TextDecoder().decode(seeded.snapshot.bytes), '# Fictional notes\n');
  } finally { await watch?.stop(); await harness?.close(context); resources.close(); rmSync(directory, { recursive: true, force: true }); }
});
