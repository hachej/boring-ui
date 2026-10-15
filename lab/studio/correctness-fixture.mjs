// Keyless scripted model and isolated demo agent shared by the browser correctness gate (which uses the model with the standard agent) and the native smoke test.
import { createScriptedModel } from '@hachej/boring-testing/model';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createAskUserTool, answerUserQuestion } from '@hachej/boring-agent/ask-user';
import assert from 'node:assert/strict';

export function createCorrectnessFixture() {
  const encode = text => new TextEncoder().encode(text);
  let target;
  const transcripts = [];
  // Two questions under the same call id (a provider may reuse one), then the answer.
  const questions = [{ question: 'Where do we picnic?', options: ['park', 'lake'] }, { question: 'Which color?', options: ['red', 'blue'] }];
  const { models, definitions: [model] } = createScriptedModel({ provider: 'fictional-correctness', api: 'fictional-correctness', generic: [],
    models: [{ id: 'fictional-correctness', name: 'Fictional correctness', input: ['text'], contextWindow: 32768, maxTokens: 1024 }],
    fallback: ctx => {
      transcripts.push(structuredClone(ctx.context));
      const question = questions[transcripts.length - 1];
      return question ? { tools: [{ id: 'reused-fictional-call', name: 'ask_user', args: question }] } : 'Fictional plan complete.';
    } });
  const demo = async host => {
    target = host.target('correctness.md');
    const seeded = await host.resources.publication.publish({ operationId: 'fictional-seed', atomicity: 'all-or-nothing', changes: [
      { kind: 'create', target, expected: { kind: 'absent' }, bytes: encode('# Fictional notes\n'), mediaType: 'text/markdown' },
    ] }, host.agentAccess);
    assert.equal(seeded.kind, 'committed');
    return { group: 'Qualification', title: 'Correctness journey', description: 'Fictional questions and document edits.',
      panel: { kind: 'markdown', target, title: 'Fictional notes' },
      artifact: { type: 'markdown', mediaType: 'text/markdown', tools: [] },
      agent: defineAgent({ id: 'correctness', model: { provider: model.provider, modelId: model.id }, tools: [createAskUserTool()] }),
      answer: (conversation, id, answer) => answerUserQuestion(conversation, id, answer, host.context),
      chat: { slash: false, mentions: false, attachments: false, models: [], efforts: [] } };
  };
  return { models, model, transcripts, demo, get target() { return target; } };
}
