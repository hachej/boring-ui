# Server template (`server.mjs`)

The host side of an agent app, adapted from [examples/workspace-app/server.mjs](../../../examples/workspace-app/server.mjs) with nothing repository-internal. It opens the Harness, one workspace and one agent, and serves the three routes the `pi-app` block calls. Save it as `server.mjs` next to `package.json` and run it with Node 22.19 or later.

Verified on 2026-10-22 against the published 0.4.8 packages in a fresh `shadcn init -t vite` app: it starts, `GET /api/conversations` answers 200 with the bearer token and 401 without it, and `GET /api/resources` answers 200.

```js
// server.mjs: the host side of an agent app. It opens Pi's Harness and one workspace, defines the agent and serves
// the three routes the pi-app block calls. Run with Node 22.19+: `OPENAI_API_KEY=... node server.mjs`.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createConversations, createConversationsHandler } from '@hachej/boring-agent/conversations';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';

const data = process.env.APP_DATA ?? '.data';
const root = join(data, 'workspace');
mkdirSync(root, { recursive: true });

// 1. Models. The key stays on the server (the OpenAI provider reads OPENAI_API_KEY).
const models = createModels();
models.setProvider(openaiProvider());

// 2. One workspace: a directory, one ExecutionEnv over it and ONE provider (revisions, history, change feed).
const person = { scopeId: 'demo-team', principalId: 'demo-person', initiatorId: 'demo-person' };
const agentAccess = { ...person, principalId: 'demo-agent' };
const env = new NodeExecutionEnv({ cwd: root });
const db = openNodeConnection(join(data, 'workspace.sqlite'));
const files = createWorkspaceProvider({
  identity: { providerId: 'workspace', instanceId: 'app', incarnation: 'app', viewId: 'published' },
  fs: env, journal: createWorkspaceJournal(db),
});
const workspace = { files, root, access: agentAccess };

// 3. The agent: Pi's own file tools behind the guard (same provider), plus `present` to open a file in the page.
const fileTools = defineExtension({ name: 'app.files', tools: [createReadTool(), createWriteTool(), createEditTool()] });
const agent = defineAgent({
  id: 'writer', model: { provider: 'openai', modelId: 'gpt-5-mini' },
  instructions: 'You write short documents for the person, save them as Markdown files and present them.',
  tools: [createPresentTool({ workspace })],
  extensions: [fileTools, createFileGuard({ workspace })],
});

// 4. The Harness: opened and closed by this process, never by a kit package.
const registry = createRegistry();
agent.install(registry);
const harness = await Harness.open(await openNodeSqliteStorage(join(data, 'session.sqlite')), { registry, models, env: () => env }, context);
const conversations = createConversations({ harness, context });
harness.resume();
const start = init => agent.createConversation(harness, context, { init });
if (!(await conversations.list({ owner: agent.id })).items.length) await conversations.create(agent.id, { start });

// 5. Routes. `allowed` is a development bearer check: replace it with your own authentication.
const token = process.env.APP_TOKEN ?? 'dev-token';
const allowed = request => request.headers.get('authorization') === `Bearer ${token}`;
const handlers = {
  '/api/conversations': createConversationsHandler({ conversations, authenticate: async request => allowed(request) ? { owner: agent.id, start } : null }),
  '/api/chat': createChatTransportHandler({ authenticate: async request => {
    const id = Number(new URL(request.url).searchParams.get('conversation'));
    const conversation = allowed(request) && Number.isSafeInteger(id) ? await conversations.open(agent.id, id) : undefined;
    return conversation ? { conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id) } : null;
  } }),
  '/api/resources': createRevisionHandler({ resolve: async request => allowed(request) ? { provider: files, access: person } : null }),
};

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, `http://${incoming.headers.host}`);
  const closed = new AbortController();
  outgoing.on('close', () => closed.abort());
  const handler = handlers[url.pathname];
  try {
    const request = handler && await webRequest(incoming, url, { signal: closed.signal });
    await sendWebResponse(request ? await handler(request) : new Response(null, { status: handler ? 413 : 404 }), outgoing, { signal: closed.signal });
  } catch (error) {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
    if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
  }
});
server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => console.log(`API on http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  server.close(); await conversations.dispose(); await harness.close(context); files.close(); db.close(); process.exit(0);
});
```

## What to change

- `allowed`: replace the bearer check with your own authentication. Return `null` from an `authenticate` or `resolve` callback to refuse.
- `person` and `agentAccess`: derive them from the signed-in person. The browser `identity` must use the same `scopeId` and `principalId`.
- `owner: agent.id`: the conversations key. Use a per-person key (for example the person id) so each person sees only their own sessions.
- The model: any provider `@earendil-works/pi-ai` ships. Keys stay in this process.
- More tools, approvals, questions or schedules: see the [agent-capabilities skill](../../agent-capabilities/SKILL.md).
