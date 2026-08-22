import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { pathToFileURL } from 'node:url';
import { mountShim } from './shim.ts';

interface StoredMessage {
	id: string;
	role: 'user' | 'assistant';
	turnId: string;
	createdAt: string;
	parts: Array<{ type: 'text'; text: string; state: 'done' }>;
}

interface Conversation {
	messages: StoredMessage[];
	settlements: Array<{ submissionId: string; outcome: 'completed' }>;
}

const conversations = new Map<string, Conversation>();
let id = 0;
export const app = new Hono();

app.get('/agents/hello/:sessionId', (c) => {
	const sessionId = c.req.param('sessionId');
	const conversation = conversations.get(sessionId) ?? { messages: [], settlements: [] };
	return c.json({ conversationId: sessionId, ...conversation });
});

app.post('/agents/hello/:sessionId', async (c) => {
	const sessionId = c.req.param('sessionId');
	const body = await c.req.json<{ body?: string }>();
	const text = body.body?.trim() || '(empty)';
	const conversation = conversations.get(sessionId) ?? { messages: [], settlements: [] };
	const turnId = `turn-${++id}`;
	const submissionId = `submission-${id}`;
	conversation.settlements = [];
	conversation.messages.push({
		id: `user-${id}`,
		role: 'user',
		turnId,
		createdAt: new Date().toISOString(),
		parts: [{ type: 'text', text, state: 'done' }],
	});
	conversations.set(sessionId, conversation);
	setTimeout(() => {
		conversation.messages.push({
			id: `assistant-${id}`,
			role: 'assistant',
			turnId,
			createdAt: new Date().toISOString(),
			parts: [{
				type: 'text',
				text: `Round trip complete. The deterministic shim received: “${text}”. This response is deliberately long enough to span several delta frames.`,
				state: 'done',
			}],
		});
		conversation.settlements = [{ submissionId, outcome: 'completed' }];
	}, 250);
	return c.json({ submissionId }, 202);
});

mountShim(app);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const port = Number(process.env.PORT ?? 8787);
	serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
		console.log(`wire spike server (${process.env.WIRE_MODE ?? 'baseline'}) on http://127.0.0.1:${info.port}`);
	});
}
