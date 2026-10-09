// A ticket is a Markdown file `<prefix><id>.md` of the workspace (FEEDBACK.md, "Tickets"), written by the assistant with Pi's own file
// tools. This module reads its front matter and mirrors it, once, to the first sink that accepts the project: the host calls
// `mirror(path)` when a write CREATED such a file (it wraps the native `write` tool), and the ticket is claimed, published by the sink
// and its outcome written back into the ticket's front matter, each write a conditional replace of the exact revision just read. A
// ticket whose front matter already has a sink's `ticket:` is never published again (replays, retries, a second call). Server only: no
// browser bundle imports it.
import type { ResourceAccess, ResourcePublisher, ResourceReader, ResourceRef } from '@hachej/boring-files';

/** One repository of a project; `role: 'app'` marks the application's own repository. */
export interface ProjectRepo { readonly repo: string; readonly role?: string }
/** What the host knows about the project the assistant works for. */
export interface ProjectInfo { readonly name: string; readonly repos: readonly ProjectRepo[] }

/** What a sink publishes: the ticket's title, Markdown body (front matter removed), labels and id (the file name without `.md`). */
export interface Ticket { readonly id: string; readonly title: string; readonly body: string; readonly labels: readonly string[] }
export interface TicketSinkContext { readonly project: ProjectInfo; readonly signal?: AbortSignal }
export type TicketSinkResult = { readonly url: string } | { readonly refused: string };

/** A platform a published ticket is mirrored to: `github`, `file`, later `linear`, `jira`... */
export interface TicketSink {
  readonly name: string;
  readonly accepts: (project: ProjectInfo) => boolean;
  readonly publish: (ticket: Ticket, context: TicketSinkContext) => Promise<TicketSinkResult>;
}

/**
 * What the front matter's `ticket:` field records. `publishing` is the claim written before the sink is called: if it stays, the sink's
 * outcome was lost and is unknown (check the platform); it is never published again.
 */
export type TicketOutcome =
  | { readonly sink: string; readonly url: string }
  | { readonly sink?: string; readonly refused: string }
  | { readonly sink: string; readonly state: 'publishing' };

export interface ParsedTicket {
  readonly ticket: Ticket;
  /** Every front matter field, values parsed as JSON when they are JSON. */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly outcome?: TicketOutcome;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FIELD = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function valueOf(raw: string): unknown {
  const text = raw.trim();
  if (!text) return '';
  try { return JSON.parse(text); } catch { return text.replace(/^(["'])(.*)\1$/, '$2'); }
}

function outcomeOf(value: unknown): TicketOutcome | undefined {
  if (!isObject(value)) return undefined;
  const sink = typeof value['sink'] === 'string' ? value['sink'] : undefined;
  if (sink && typeof value['url'] === 'string') return { sink, url: value['url'] };
  if (typeof value['refused'] === 'string') return { ...(sink ? { sink } : {}), refused: value['refused'] };
  if (sink && value['state'] === 'publishing') return { sink, state: 'publishing' };
  return undefined;
}

/**
 * Read a ticket's Markdown: optional `---` front matter of `key: value` lines (values are JSON, which is also YAML flow, or plain text),
 * then the body. The title is the `title` field, else the first `# ` heading, else the id; labels are the `labels` field's strings.
 */
export function parseTicket(id: string, markdown: string): ParsedTicket {
  const match = FRONT.exec(markdown);
  const fields: Record<string, unknown> = {};
  if (match) for (const line of match[1]!.split(/\r?\n/)) {
    const field = FIELD.exec(line);
    if (field) fields[field[1]!] = valueOf(field[2]!);
  }
  const body = (match ? markdown.slice(match[0].length) : markdown).trim();
  const heading = /^#[ \t]+(.+)$/m.exec(body)?.[1]?.trim();
  const title = typeof fields['title'] === 'string' && fields['title'].trim() ? fields['title'].trim() : heading || id;
  const labels = Array.isArray(fields['labels']) ? [...new Set(fields['labels'].filter((label): label is string => typeof label === 'string' && label.trim() !== '').map(label => label.trim()))] : [];
  const outcome = outcomeOf(fields['ticket']);
  return { ticket: { id, title, body, labels }, fields, ...(outcome ? { outcome } : {}) };
}

/** The same Markdown with its front matter's `ticket:` field set to `outcome` (added, or a front matter created). Nothing else changes. */
export function withTicketOutcome(markdown: string, outcome: TicketOutcome): string {
  const line = `ticket: ${JSON.stringify(outcome)}`;
  const match = FRONT.exec(markdown);
  if (!match) return `---\n${line}\n---\n${markdown}`;
  const lines = match[1]!.split(/\r?\n/);
  const at = lines.findIndex(item => /^ticket:/.test(item));
  if (at >= 0) lines[at] = line; else lines.push(line);
  return `---\n${lines.join('\n')}\n---\n${markdown.slice(match[0].length)}`;
}

export interface TicketSinkOptions {
  /** The workspace provider (or its host wrapper): reads the ticket (latest revision) and replaces it conditionally. */
  readonly files: ResourceReader & { readonly publication: ResourcePublisher; readonly providerId: string };
  readonly project: ProjectInfo;
  /** In order of preference: the first whose `accepts(project)` is true publishes. */
  readonly sinks: readonly TicketSink[];
  /** Folder of the tickets, relative to the workspace. Defaults to `tickets/`. */
  readonly prefix?: string;
}

/** What `mirror` did: the outcome now recorded in the ticket, or why nothing was published. */
export type TicketMirrorResult =
  | { readonly kind: 'recorded'; readonly outcome: TicketOutcome }
  | { readonly kind: 'skipped'; readonly reason: string };

export interface TicketSinks {
  /** Whether `path` (workspace-relative) names a ticket. */
  readonly isTicket: (path: string) => boolean;
  /**
   * Mirror the ticket at `path`, which a write just created: claim it, publish it to the first accepting sink and record the outcome.
   * `created` is the revision the creating write left, when the host knows it: a `ticket:` field in that revision was written by the
   * author, not by a sink, so it is replaced rather than trusted. Never throws.
   */
  readonly mirror: (path: string, access: ResourceAccess, created?: string) => Promise<TicketMirrorResult>;
}

const decode = (bytes: Uint8Array) => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; } };
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let operations = 0;

/** The ticket sinks over the workspace: `mirror` publishes each new ticket once and writes the outcome back into its front matter. */
export function createTicketSinks(options: TicketSinkOptions): TicketSinks {
  const { files, project, sinks } = options;
  const prefix = options.prefix ?? 'tickets/';
  if (prefix && (!prefix.endsWith('/') || prefix.startsWith('/'))) throw new TypeError('The ticket folder must be relative and end with a slash');
  const pattern = new RegExp(`^${escapeRegExp(prefix)}([A-Za-z0-9][A-Za-z0-9_-]{0,63})\\.md$`);
  const idOf = (path: string) => { const id = pattern.exec(path)?.[1]; return id && ID.test(id) ? id : undefined; };

  async function latest(path: string, access: ResourceAccess) {
    const read = await files.read({ target: { resource: { providerId: files.providerId, path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
    if (read.kind !== 'available') return undefined;
    const text = decode(read.snapshot.bytes);
    return text === undefined ? undefined : { ref: read.snapshot.ref, text, mediaType: read.snapshot.mediaType };
  }

  /** Conditional replace of the exact revision read, with `outcome` in the front matter. Returns whether it committed. */
  async function record(current: { readonly ref: ResourceRef; readonly text: string; readonly mediaType: string }, outcome: TicketOutcome, access: ResourceAccess) {
    const operationId = `boring.ticket.${current.ref.resource.path}.${current.ref.revision}.${Date.now().toString(36)}.${++operations}`;
    const result = await files.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [
      { kind: 'replace', target: current.ref, bytes: new TextEncoder().encode(withTicketOutcome(current.text, outcome)), mediaType: current.mediaType },
    ] }, access);
    return result.kind === 'committed';
  }

  async function mirror(path: string, access: ResourceAccess, created?: string): Promise<TicketMirrorResult> {
    const id = idOf(path);
    if (!id) return { kind: 'skipped', reason: 'Not a ticket path' };
    const current = await latest(path, access);
    if (!current) return { kind: 'skipped', reason: 'The ticket could not be read' };
    const parsed = parseTicket(id, current.text);
    // Already claimed or published: never twice. A `ticket:` field in the created revision itself was written by the author.
    if (parsed.outcome && current.ref.revision !== created) return { kind: 'skipped', reason: 'The ticket already records a sink outcome' };
    const sink = sinks.find(candidate => { try { return candidate.accepts(project); } catch { return false; } });
    if (!sink) {
      const outcome: TicketOutcome = { refused: `No ticket sink accepts the project "${project.name}"` };
      return await record(current, outcome, access) ? { kind: 'recorded', outcome } : { kind: 'skipped', reason: 'The ticket changed before the refusal was recorded' };
    }
    // The claim: a conditional replace of the revision just read. Losing it (a person edited the ticket, another call claimed it)
    // publishes nothing.
    if (!await record(current, { sink: sink.name, state: 'publishing' }, access)) return { kind: 'skipped', reason: 'The ticket changed before it was claimed' };
    let result: TicketSinkResult;
    try {
      result = await sink.publish(parsed.ticket, { project, ...(access.signal ? { signal: access.signal } : {}) });
    } catch (error) {
      result = { refused: `The ${sink.name} sink did not complete (${error instanceof Error ? error.message : 'unknown error'}); check ${sink.name} before filing again` };
    }
    const outcome: TicketOutcome = 'url' in result ? { sink: sink.name, url: result.url } : { sink: sink.name, refused: result.refused };
    // The outcome replaces the claim. A person editing between the two writes only costs a re-read; three tries, then the claim stays.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await latest(path, access);
      const state = claimed ? parseTicket(id, claimed.text).outcome : undefined;
      if (!claimed || !state || !('state' in state)) break;
      if (await record(claimed, outcome, access)) return { kind: 'recorded', outcome };
    }
    return { kind: 'recorded', outcome: { sink: sink.name, state: 'publishing' } };
  }

  return Object.freeze({
    isTicket: (path: string) => idOf(path) !== undefined,
    mirror: async (path: string, access: ResourceAccess, created?: string) => {
      try { return await mirror(path, { ...access }, created); }
      catch { return { kind: 'skipped', reason: 'The ticket stays as written; its front matter shows no outcome' } as const; }
    },
  });
}
