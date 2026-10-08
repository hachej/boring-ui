// The same standard agent with no server and no UI: a letter is drafted with the letter-style skill, then a second conversation
// reviews it. Needs a provider key (OPENAI_API_KEY by default). Fictional content only.
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { defineStandardAgent } from '../shared/standard-agent.mjs';
import { readFiles, writeFiles } from '../shared/workspace-tools.mjs';
import { NOTES } from './fixtures/workspace-files.mjs';

const provider = process.env.STUDIO_PROVIDER ?? 'openai';
const modelId = process.env.STUDIO_MODEL ?? 'gpt-5-mini';
const models = createModels();
models.setProvider((await import(`@earendil-works/pi-ai/providers/${provider}`))[`${provider}Provider`]());

// No workspace provider: the agent works on the virtual workspace with Pi's own file tools, unguarded (nothing else writes there).
const { agent } = defineStandardAgent({ model: { provider, modelId }, cwd: '/workspace',
  parts: [{ capabilities: ['workspace'], extensions: [readFiles, writeFiles] }] });

const workspace = createVirtualWorkspace({ providerId: 'studio-headless', files: Object.fromEntries(Object.entries(NOTES).map(([path, text]) => [`/workspace/${path}`, text])) });
const lease = await workspace.acquire({ operationId: 'headless', input: { cwd: '/workspace' } }, context);
const registry = createRegistry();
agent.install(registry);
const harness = await Harness.open(new MemoryStorage(), { registry, models, env: () => lease.environment }, context);

async function run(text) {
  const conversation = await agent.createConversation(harness, context);
  const settled = await (await conversation.submit({ type: 'input', requestId: crypto.randomUUID(), content: text }, context)).wait(context);
  if (settled.status !== 'done') throw new Error(`The agent did not answer: ${settled.reason ?? settled.status} ${settled.detail ?? ''}`);
  await conversation.waitForIdle(context);
  const messages = (await conversation.context(context)).entries.flatMap(entry => entry.model ?? []);
  const calls = messages.flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall').map(part => part.name) : []);
  const reply = messages.filter(message => message.role === 'assistant').at(-1).content.filter(part => part.type === 'text').map(part => part.text).join('');
  return { calls, reply };
}

try {
  const drafted = await run('/letter-style Write the physiotherapy referral letter for the patient in notes/consultation.md and save it as a file in the workspace with the write tool.');
  const files = (await lease.environment.listDir('/workspace/letters', context)).value ?? [];
  const letter = files[0] ? (await lease.environment.readTextFile(`/workspace/letters/${files[0].name}`, context)).value : undefined;
  const reviewed = await run('Read the referral letter in letters/ and notes/consultation.md, then review the letter against those notes with at most three short bullet points. Do not change any file.');
  console.log(JSON.stringify({ model: modelId, drafted: { toolCalls: drafted.calls, reply: drafted.reply, file: files[0]?.name, letter }, reviewed: { toolCalls: reviewed.calls, reply: reviewed.reply } }, null, 2));
  if (!letter) throw new Error('The agent saved no letter');
} finally { await harness.close(context); await lease.release(context); workspace.dispose(); }
