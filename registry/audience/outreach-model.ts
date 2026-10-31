// The Outreach and Inbox panels' data (Audience tab). Mirrors env.outreach (server/src/host.ts `Outreach`): the host sends, this only shapes what it answers
// and what the app reads from its drafts. A body from the inbox is somebody else's text: it is shown as text and never interpreted.

export interface OutreachProfile { readonly name: string; readonly company: string; readonly postal: string }
/** One draft: `documents/outreach/<id>.md`. The subject is its `Subject:` line (or first `# ` heading); the rest is the body, which may hold `{{link}}`. */
export interface OutreachDraft { readonly id: string; readonly subject: string; readonly text: string }
/** One recipient of the list `documents/outreach/recipients.txt`: an address, and the `?ref=` id the draft link carries for them. */
export interface OutreachRecipient { readonly email: string; readonly ref: string }
export interface SendLogRow { readonly id: string; readonly to: string; readonly at: number; readonly draft: string; readonly ref: string; readonly subject: string; readonly messageId: string | null; readonly inReplyTo: string | null; readonly status: string }
/** What the host would send, from `prepare`: shown in full in the confirm dialog. `confirm` is the single-use token `send` needs. */
export interface Prepared { readonly confirm: string; readonly expiresAt: number; readonly from: string; readonly to: string; readonly subject: string; readonly text: string; readonly remaining: number }
/** The message of one send (a first send or a reply). */
export interface OutgoingMessage { readonly to: string; readonly draft: string; readonly subject: string; readonly text: string; readonly ref: string; readonly inReplyTo?: string }
export interface InboxThreadRow { readonly thread: string; readonly messages: number; readonly unread: number; readonly lastAt: number; readonly from: string; readonly subject: string; readonly draft: string; readonly ref: string }
export type ThreadMessage =
  | { readonly direction: 'in'; readonly id: string; readonly at: number; readonly from: string; readonly subject: string; readonly text: string; readonly messageId: string }
  | { readonly direction: 'out'; readonly id: string; readonly at: number; readonly to: string; readonly subject: string; readonly messageId: string | null; readonly status: string };
export interface ThreadView { readonly thread: string; readonly draft: string; readonly ref: string; readonly messages: readonly ThreadMessage[] }
/** What the app's `/api/outreach` route answers; `available` is false where the host has no env.outreach (the local runtime, or an app the host has not switched on). */
export interface OutreachData { readonly available: boolean; readonly profile: OutreachProfile; readonly log: readonly SendLogRow[]; readonly unread: number; readonly threads: readonly InboxThreadRow[] }

export const DAILY_SENDS = 20;
const EMAIL = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const REF = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The draft in `markdown`: `Subject: ...` on the first line, or a `# Heading`; the rest, trimmed, is the body. A file with no subject is not a draft (null). */
export function parseDraft(id: string, markdown: string): OutreachDraft | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) return null;
  const match = /^(?:subject:|#)\s*(.+)$/i.exec(lines[first].trim());
  const subject = match?.[1]?.trim().slice(0, 200);
  const text = lines.slice(first + 1).join('\n').trim();
  return subject && text ? { id, subject, text } : null;
}

/** An id for the visit counter from an address: `ada@acme.fr` is `ada-acme-fr`, at most 32 characters, never the address itself in the link twice. */
export function refFor(email: string): string {
  const base = email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return REF.test(base) ? base : 'r';
}

/** The list: one recipient a line, `address` or `address, ref`; blank lines and `#` comments ignored; a bad address is skipped; a repeated address counts once. */
export function parseRecipients(text: string): readonly OutreachRecipient[] {
  const seen = new Set<string>();
  const out: OutreachRecipient[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [address = '', ref = ''] = line.split(/[,;\t]/).map((part) => part.trim());
    const email = address.toLowerCase();
    if (!EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, ref: REF.test(ref.toLowerCase()) ? ref.toLowerCase() : refFor(email) });
  }
  return out;
}

/** Whether the owner has filled the three lines of the footer: no send is possible before. */
export const footerReady = (profile: OutreachProfile): boolean => [profile.name, profile.company, profile.postal].every((v) => v.trim() !== '');

/** Sends in the last 24 hours that count toward the day's 20 (a send that failed does not). */
export function sentToday(log: readonly SendLogRow[], now: number): number {
  return log.filter((r) => r.at > now - 86_400_000 && ['sent', 'uncertain', 'delivering'].includes(r.status)).length;
}

/** Recipients who were already written to with this draft (a repeat is possible, but the list says so), keyed by address. */
export function alreadySent(log: readonly SendLogRow[], draft: string): ReadonlySet<string> {
  return new Set(log.filter((r) => r.draft === draft && !r.inReplyTo && ['sent', 'uncertain'].includes(r.status)).map((r) => r.to));
}

/** The subject of a reply: `Re: ` once. */
export const replySubject = (subject: string): string => (/^re:/i.test(subject) ? subject : `Re: ${subject}`).slice(0, 200);

/** `/api/outreach` answer, checked: anything that is not the shape is dropped to the empty state, never thrown into the page. */
export function readOutreach(value: unknown): OutreachData {
  const v = (value ?? {}) as Partial<OutreachData>;
  const p = (v.profile ?? {}) as Partial<OutreachProfile>;
  const text = (x: unknown): string => (typeof x === 'string' ? x : '');
  return {
    available: v.available === true,
    profile: { name: text(p.name), company: text(p.company), postal: text(p.postal) },
    log: Array.isArray(v.log) ? v.log.filter((r) => r && typeof r.id === 'string' && typeof r.to === 'string' && Number.isFinite(r.at)) : [],
    unread: Number.isFinite(v.unread) ? Number(v.unread) : 0,
    threads: Array.isArray(v.threads) ? v.threads.filter((t) => t && typeof t.thread === 'string' && typeof t.from === 'string') : [],
  };
}
