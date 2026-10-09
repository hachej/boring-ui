// Tickets in the feedback demo (FEEDBACK.md, "Tickets"): the project the builder works for, the sinks a new ticket is mirrored to, and
// the page a file-sink link opens. By default the fictional Fernhill project names no repository, so tickets stay files in this
// workspace (the file sink). `FEEDBACK_TICKET_REPO=owner/name` plus `GITHUB_TOKEN` (server environment only, never sent to the browser
// or logged) switches the demo to the GitHub sink; the file sink stays as the fallback. Fictional content only.
//
// The trigger: the builder writes `tickets/<id>.md` with Pi's own `write` tool. `ticketsOnWrite` wraps that tool (after the file guard):
// when a write CREATED a ticket file, `createTicketSinks(...).mirror` publishes it and the outcome is added to the write's result, so
// the assistant can give the person the link. The front matter keeps the outcome, so a ticket is published once.
import { Marked } from 'marked';
import { defineExtension, wrapTool } from '@earendil-works/pi-durable';
import { createWriteTool } from '@earendil-works/pi-durable/tools';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { fileSink, githubSink, parseTicket } from '@hachej/boring-feedback/tickets';

export const TICKETS_ROOT = 'tickets/';
const TICKET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The demo's project: Fernhill Studio, with `FEEDBACK_TICKET_REPO` as its app repository when set. */
export function ticketProjectFromEnv(env = process.env) {
  const repo = env.FEEDBACK_TICKET_REPO?.trim();
  return { name: 'Fernhill Studio', repos: repo ? [{ repo, role: 'app' }] : [] };
}

/** The sinks, in order: GitHub when a token is in the server environment, then the file sink. */
export function ticketSinksFromEnv(env = process.env) {
  return ({ linkFor }) => [...(env.GITHUB_TOKEN ? [githubSink({ token: env.GITHUB_TOKEN })] : []), fileSink({ linkFor })];
}

/**
 * A native extension that wraps Pi's `write` (select it after the file guard): after a write that created `<prefix><id>.md`, the ticket
 * is mirrored with `tickets.mirror` and the result gains a line `Ticket: {...}` with the recorded outcome. `files` reads revisions,
 * `root` is the workspace root as the ExecutionEnv names it, `resolveAccess(api)` the caller's access.
 */
export function ticketsOnWrite({ tickets, files, root, resolveAccess }) {
  const base = root.replace(/\/+$/, '');
  const revisionOf = async (path, access) => {
    const read = await files.read({ target: { resource: { providerId: files.providerId, path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
    return read.kind === 'available' ? read.snapshot.ref.revision : undefined;
  };
  const wrapped = tool => ({ ...tool, execute: async (args, api, context) => {
    const absolute = api.env ? getOrThrow(await api.env.absolutePath(String(args.path ?? ''), context)) : '';
    const path = absolute.startsWith(`${base}/`) ? absolute.slice(base.length + 1) : undefined;
    if (!path || !tickets.isTicket(path)) return tool.execute(args, api, context);
    const access = await resolveAccess(api, context);
    const existed = await revisionOf(path, access) !== undefined;
    const result = await tool.execute(args, api, context);
    if (result.isError || existed) return result;
    const mirrored = await tickets.mirror(path, access, await revisionOf(path, access));
    const line = mirrored.kind === 'recorded' ? `Ticket: ${JSON.stringify(mirrored.outcome)}` : `Ticket not published: ${mirrored.reason}`;
    return { ...result, content: [...result.content, { type: 'text', text: line }] };
  } });
  return defineExtension({ name: 'fernhill.tickets', wraps: [wrapTool(createWriteTool(), wrapped)] });
}

/** The outcome a `ticketsOnWrite` result carries, or undefined. */
export function ticketOutcomeOf(text) {
  const line = /^Ticket: (\{.*\})$/m.exec(text)?.[1];
  if (!line) return undefined;
  try { return JSON.parse(line); } catch { return undefined; }
}

const escapeHtml = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
// Ticket text came from a person's notes through the agent: raw HTML is shown as text and only http(s) or same-site links stay links.
const markdown = new Marked({
  renderer: { html: ({ text }) => escapeHtml(text) },
  walkTokens: token => { if ((token.type === 'link' || token.type === 'image') && !/^(?:https?:\/\/|\/(?!\/)|#)/i.test(token.href)) token.href = '#'; },
});

/** The ticket page a file-sink link opens: its front matter as a table, then its body. `undefined` when `id` is not a ticket id. */
export async function ticketPage({ reader, providerId, access, id }) {
  if (!TICKET_ID.test(id)) return undefined;
  const read = await reader.read({ target: { resource: { providerId, path: `${TICKETS_ROOT}${id}.md` }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
  if (read.kind !== 'available') return { status: read.kind === 'missing' ? 404 : read.kind === 'denied' ? 403 : 503, html: page('Ticket not found', `<p>No ticket ${escapeHtml(id)} (${escapeHtml(read.kind)}).</p>`) };
  const parsed = parseTicket(id, new TextDecoder().decode(read.snapshot.bytes));
  const rows = Object.entries(parsed.fields).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value))}</td></tr>`).join('');
  return { status: 200, html: page(parsed.ticket.title, `<p class="meta">Ticket <code>${escapeHtml(id)}</code> · revision <code>${escapeHtml(read.snapshot.ref.revision.slice(0, 8))}</code></p>
<table data-testid="ticket-fields">${rows}</table><article data-testid="ticket-body">${await markdown.parse(parsed.ticket.body)}</article>`) };
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} (fictional)</title><style>
:root{color-scheme:light;--fg:#1a211d;--muted:#5c6b63;--border:#dce3de;--card:#fff;--bg:#f3f5f2}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:1.5rem auto;padding:1.25rem 1.5rem;background:var(--card);border:1px solid var(--border);border-radius:.625rem}
h1{font-size:1.3rem;margin:0 0 .25rem}.meta{color:var(--muted);margin:0 0 1rem}table{border-collapse:collapse;width:100%;margin-bottom:1rem;font-size:13px}
th,td{border-top:1px solid var(--border);padding:.3rem .5rem;text-align:left;vertical-align:top;word-break:break-word}th{color:var(--muted);width:7rem;font-weight:500}
code{font-size:.9em;background:#eaeee9;padding:0 .2em;border-radius:3px}h3{margin:1.25rem 0 .4rem;font-size:1rem}
</style></head><body><main data-testid="ticket"><h1 data-testid="ticket-title">${escapeHtml(title)}</h1>${body}</main></body></html>`;
