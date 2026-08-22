/**
 * AgentGateway -> Flue translation shim.
 *
 * Serves the subset of boring-ui's AgentGateway HTTP surface that PiChatPanel
 * needs, backed by a Flue agent conversation. Runs inside the Flue worker, so
 * the whole path is: PiChatPanel -> shim -> Flue agent -> celld cell.
 *
 * Event derivation is DETERMINISTIC and STATELESS: the same Flue history always
 * yields the same seq-numbered PiChatEvent list, so `?cursor=N` resume is just a
 * slice. Flue's protocol is state-based (materialized parts + lifecycle state)
 * and never exposes deltas, so this emits part-level events -- never
 * `message-delta`.
 */
import type { Context, Hono } from 'hono';

type FluePart =
	| { type: 'text' | 'reasoning'; text?: string; state?: string }
	| { type: 'dynamic-tool'; toolName: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string }
	| { type: string; [k: string]: unknown };

interface FlueMessage { id: string; role: string; parts?: FluePart[]; turnId?: string; createdAt?: string }
interface FlueSettlement { submissionId: string; outcome: string; error?: { message?: string } }
interface FlueHistory { conversationId: string; messages?: FlueMessage[]; settlements?: FlueSettlement[] }

const AGENT_TYPE_ID = 'hello';
const BASE_TIME = 1_780_000_000_000;
const sessions = new Map<string, { title: string; createdAt: number; updatedAt: number }>();
const WIRE_MODE = process.env.WIRE_MODE ?? 'baseline';
const IMPLICIT_SESSION_CREATE = WIRE_MODE === 'implicit-session';
const OPAQUE_CURSORS = WIRE_MODE === 'opaque-cursors';
const DROP_DELTAS = WIRE_MODE === 'drop-deltas';
const STREAM_TICKS = Number(process.env.WIRE_STREAM_TICKS ?? 600);

function wireCursor(seq: number): number | string {
	return OPAQUE_CURSORS ? `resume_${Buffer.from(`seq:${seq}`).toString('base64url')}` : seq;
}

function readWireCursor(value: string | undefined): number {
	if (!OPAQUE_CURSORS) return Number(value ?? '0') || 0;
	if (!value?.startsWith('resume_')) return 0;
	const decoded = Buffer.from(value.slice('resume_'.length), 'base64url').toString();
	return Number(decoded.replace(/^seq:/, '')) || 0;
}

function derive(h: FlueHistory, sessionId: string) {
	const events: Array<Record<string, unknown>> = [];
	const messages: Array<Record<string, unknown>> = [];
	let seq = 0;
	const push = (e: Record<string, unknown>, emit = true) => {
		const eventSeq = ++seq;
		if (emit) events.push({ ...e, seq: wireCursor(eventSeq) });
	};
	let openTurn: string | undefined;
	// Seq stability: a still-streaming message grows between polls, so any event
	// emitted after it would shift. Only the prefix BEFORE the last message is
	// stable until the conversation settles.
	let stableSeq = 0;

	const settledNow = (h.settlements ?? []).length > 0;
	for (const m of h.messages ?? []) {
		stableSeq = seq + 1;
		const role = m.role === 'user' ? 'user' : 'assistant';
		const turnId = m.turnId ?? `turn-${m.id}`;
		if (role === 'assistant' && openTurn !== turnId) {
			if (openTurn) push({ type: 'agent-end', turnId: openTurn, status: 'ok' });
			openTurn = turnId;
			push({ type: 'agent-start', turnId });
		}

		const parts: Array<Record<string, unknown>> = [];
		const text = (m.parts ?? []).filter((p) => p.type === 'text').map((p) => (p as { text?: string }).text ?? '').join('');
		push({ type: 'message-start', messageId: m.id, role, createdAt: m.createdAt ?? new Date(BASE_TIME + messages.length * 1000).toISOString(), ...(role === 'user' ? { text } : {}) });

		for (const p of m.parts ?? []) {
			if (p.type === 'text' || p.type === 'reasoning') {
				const t = (p as { text?: string }).text ?? '';
				const partId = `${m.id}:${parts.length}`;
				if (DROP_DELTAS && role === 'assistant') {
					const chunks = t.match(/.{1,12}/gs) ?? [];
					chunks.forEach((delta, index) => {
						// Simulate transport loss: skipped frames retain their sequence slots,
						// making the following event expose a real replay gap.
						push({ type: 'message-delta', messageId: m.id, partId, kind: p.type, delta }, index % 3 !== 1);
					});
				} else {
					push({ type: 'message-part-end', messageId: m.id, partId, kind: p.type, text: t });
				}
				parts.push(p.type === 'reasoning' ? { type: 'reasoning', id: partId, text: t, state: 'done' } : { type: 'text', id: partId, text: t });
			} else if (p.type === 'dynamic-tool') {
				const tp = p as { toolName: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string };
				push({ type: 'tool-call', messageId: m.id, toolCallId: tp.toolCallId, toolName: tp.toolName, input: tp.input });
				if (tp.state === 'output-available') push({ type: 'tool-result', messageId: m.id, toolCallId: tp.toolCallId, output: tp.output });
				else if (tp.state === 'output-error') push({ type: 'tool-result', messageId: m.id, toolCallId: tp.toolCallId, output: undefined, isError: true, errorText: tp.errorText });
				parts.push({
					type: 'tool-call', id: tp.toolCallId, toolName: tp.toolName, input: tp.input,
					state: tp.state === 'output-available' ? 'output-available' : tp.state === 'output-error' ? 'output-error' : 'input-available',
					...(tp.output !== undefined ? { output: tp.output } : {}),
					...(tp.errorText ? { errorText: tp.errorText } : {}),
				});
			}
		}

		// Ordering: Flue does not always carry createdAt, and the panel orders by
		// it -- a missing value floats the message out of sequence. Synthesize a
		// monotonic stamp from the message index instead.
		const createdAt = m.createdAt ?? new Date(BASE_TIME + messages.length * 1000).toISOString();
		const final = { id: m.id, role, parts, createdAt, turnId: role === 'assistant' ? turnId : undefined, status: 'done' };
		push({ type: 'message-end', messageId: m.id, final });
		messages.push(final);
	}

	for (const s of h.settlements ?? []) {
		if (s.outcome === 'failed') push({ type: 'error', turnId: openTurn, error: { code: 'AGENT_TURN_FAILED', message: s.error?.message ?? 'failed' } });
	}
	if (openTurn) push({ type: 'agent-end', turnId: openTurn, status: (h.settlements ?? []).some((s) => s.outcome === 'failed') ? 'error' : 'ok' });

	const settled = settledNow;
	if (settled) stableSeq = seq + 1;
	const snapshot = {
		protocolVersion: 1, sessionId, seq: wireCursor(seq), status: messages.length > 0 && !settled ? 'streaming' : 'idle',
		messages, queue: { followUps: [] }, followUpMode: 'one-at-a-time',
	};
	return { events, snapshot, stableSeq };
}

async function history(origin: string, sessionId: string): Promise<FlueHistory> {
	const r = await fetch(`${origin}/agents/hello/${encodeURIComponent(sessionId)}`);
	if (!r.ok) return { conversationId: sessionId, messages: [], settlements: [] };
	return (await r.json()) as FlueHistory;
}

export function mountShim(app: Hono) {
	const base = '/shim/api/v1/agents';

	// The host app is served from a different origin (Vite dev server), so the
	// gateway projection needs permissive CORS for this spike.
	app.use('/shim/*', async (c, next) => {
		if (c.req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: {
				'access-control-allow-origin': '*',
				'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
				'access-control-allow-headers': '*',
			} });
		}
		await next();
		c.res.headers.set('access-control-allow-origin', '*');
		c.res.headers.set('access-control-expose-headers', '*');
	});

	// legacy stubs: this build's panel still probes the unaddressed surfaces for
	// models/commands/session-list. Empty payloads keep those features inert
	// without 404 noise; the chat itself uses the addressed routes below.
	app.get('/shim/api/v1/agent/models', (c) => c.json({
		models: [{ provider: 'google', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', available: true }],
		defaultModel: { provider: 'google', id: 'gemini-2.5-flash' },
	}));
	app.get('/shim/api/v1/agent/skills', (c) => c.json([]));
	app.get('/shim/api/v1/agent/commands', (c) => c.json({ commands: [] }));
	app.post('/shim/api/v1/agent/commands/execute', (c) => c.json({ ok: true }));

	app.get(base, (c) => c.json([{ agentTypeId: AGENT_TYPE_ID, label: 'Hello (Flue on celld)', description: 'Flue agent hosted in a celld cell' }]));

	app.get(`${base}/:agentTypeId/sessions`, (c) => c.json({
		sessions: [...sessions.entries()].map(([sessionId, s]) => ({
			ref: { agentTypeId: AGENT_TYPE_ID, sessionId },
			title: s.title, status: 'idle', createdAt: s.createdAt, updatedAt: s.updatedAt,
		})),
	}));

	if (!IMPLICIT_SESSION_CREATE) app.post(`${base}/:agentTypeId/sessions`, async (c) => {
		const sessionId = `s-${Math.random().toString(36).slice(2, 10)}`;
		const now = Date.now();
		sessions.set(sessionId, { title: 'New chat', createdAt: now, updatedAt: now });
		return c.json({ agentTypeId: AGENT_TYPE_ID, sessionId });
	});

	app.get(`${base}/:agentTypeId/sessions/:sessionId/state`, async (c) => {
		const sessionId = c.req.param('sessionId')!;
		const { snapshot } = derive(await history(new URL(c.req.url).origin, sessionId), sessionId);
		const s = sessions.get(sessionId);
		return c.json({
			ref: { agentTypeId: AGENT_TYPE_ID, sessionId }, seq: snapshot.seq,
			summary: { ref: { agentTypeId: AGENT_TYPE_ID, sessionId }, title: s?.title ?? sessionId, status: 'idle', createdAt: s?.createdAt ?? Date.now(), updatedAt: Date.now() },
			state: snapshot,
		});
	});

	app.post(`${base}/:agentTypeId/sessions/:sessionId/prompt`, async (c) => {
		const sessionId = c.req.param('sessionId');
		const body = await c.req.json<{ text?: string; message?: string | { text?: string } }>();
		const text = body.text ?? (typeof body.message === 'string' ? body.message : body.message?.text) ?? '';
		if (!sessions.has(sessionId)) sessions.set(sessionId, { title: text.slice(0, 40) || 'New chat', createdAt: Date.now(), updatedAt: Date.now() });
		const r = await fetch(`${new URL(c.req.url).origin}/agents/hello/${encodeURIComponent(sessionId)}`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: 'user', body: text }),
		});
		const admission = await r.json() as { submissionId?: string };
		return c.json({ accepted: true, submissionId: admission.submissionId }, 202);
	});

	// NDJSON PiChatEvent stream, cursor = last seq the client already has.
	app.get(`${base}/:agentTypeId/sessions/:sessionId/events`, (c) => streamEvents(c));

	function streamEvents(c: Context) {
		const sessionId = c.req.param('sessionId')!;
		const origin = new URL(c.req.url).origin;
		let cursor = readWireCursor(c.req.query('cursor'));
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const write = (o: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
				write({ type: 'heartbeat', now: new Date().toISOString() });
				for (let tick = 0; tick < STREAM_TICKS; tick++) {
					const { events, stableSeq } = derive(await history(origin, sessionId), sessionId);
					for (const e of events) {
						const raw = e.seq;
						const s = typeof raw === 'number' ? raw : readWireCursor(String(raw));
						if (s >= cursor && s < stableSeq) { write(e); cursor = s + 1; }
					}
					if (tick % 10 === 9) write({ type: 'heartbeat', now: new Date().toISOString() });
					await new Promise((r) => setTimeout(r, 700));
				}
				controller.close();
			},
		});
		return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache, no-transform', 'access-control-allow-origin': '*' } });
	}

	// ---- legacy unaddressed aliases -------------------------------------------
	// This build's ChatPanel talks to /api/v1/agent/pi-chat/* rather than the
	// addressed /api/v1/agents/:agentTypeId/* surface. Same handlers, both paths.
	const legacy = '/shim/api/v1/agent/pi-chat';

	// SessionSummary: { id, title, createdAt: ISO, updatedAt: ISO, turnCount }
	const summary = (sessionId: string, s: { title: string; createdAt: number; updatedAt: number }) => ({
		id: sessionId, title: s.title,
		createdAt: new Date(s.createdAt).toISOString(),
		updatedAt: new Date(s.updatedAt).toISOString(),
		turnCount: 0,
	});

	// fetchSessionList expects a BARE ARRAY of SessionSummary, not an envelope.
	app.get(`${legacy}/sessions`, (c) => c.json([...sessions.entries()].map(([id, s]) => summary(id, s))));

	if (!IMPLICIT_SESSION_CREATE) app.post(`${legacy}/sessions`, (c) => {
		const sessionId = `s-${Math.random().toString(36).slice(2, 10)}`;
		const now = Date.now();
		const rec = { title: 'New chat', createdAt: now, updatedAt: now };
		sessions.set(sessionId, rec);
		return c.json(summary(sessionId, rec));
	});

	app.get(`${legacy}/:sessionId/state`, async (c) => {
		const sessionId = c.req.param('sessionId');
		const { snapshot } = derive(await history(new URL(c.req.url).origin, sessionId), sessionId);
		return c.json(snapshot);
	});

	// PromptReceipt: { accepted: true, cursor: number, clientNonce: string }
	app.post(`${legacy}/:sessionId/prompt`, async (c) => {
		const sessionId = c.req.param('sessionId');
		const origin = new URL(c.req.url).origin;
		const body = await c.req.json<{ text?: string; clientNonce?: string; message?: string | { text?: string } }>().catch(() => ({} as Record<string, never>));
		const text = body.text ?? (typeof body.message === 'string' ? body.message : body.message?.text) ?? '';
		const now = Date.now();
		const existing = sessions.get(sessionId);
		sessions.set(sessionId, { title: existing?.title && existing.title !== 'New chat' ? existing.title : (text.slice(0, 40) || 'New chat'), createdAt: existing?.createdAt ?? now, updatedAt: now });
		const { snapshot } = derive(await history(origin, sessionId), sessionId);
		await fetch(`${origin}/agents/hello/${encodeURIComponent(sessionId)}`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: 'user', body: text }),
		});
		return c.json({ accepted: true, cursor: snapshot.seq, clientNonce: body.clientNonce ?? `n-${now}`, sessionId }, 202);
	});

	for (const p of ['followup', 'interrupt', 'stop', 'queue/clear']) {
		app.post(`${legacy}/:sessionId/${p}`, (c) => c.json({ ok: true }));
	}

	app.get(`${legacy}/:sessionId/events`, (c) => streamEvents(c));
}
