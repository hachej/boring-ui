// The two ticket sinks the package ships (FEEDBACK.md, "Tickets"): `githubSink` opens an issue in the project's repository through the
// GitHub REST API, `fileSink` keeps the ticket file itself as the ticket and answers its link. Others (Linear, Jira...) implement the
// same `TicketSink`. The GitHub token stays in the closure: it is sent only in the Authorization header and never appears in a result.
import type { ProjectInfo, Ticket, TicketSink, TicketSinkContext, TicketSinkResult } from './ticket.js';

export const GITHUB_API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The repository a project's tickets go to: the one with role `app`, else the first; only `owner/name` entries count. */
export function ticketRepoOf(project: ProjectInfo): string | undefined {
  const repos = project.repos.filter(item => REPO.test(item.repo));
  return (repos.find(item => item.role === 'app') ?? repos[0])?.repo;
}

export interface GithubSinkOptions {
  /** A token that may create issues in the project's repository. Server environment only. */
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Defaults to https://api.github.com (GitHub Enterprise: `https://<host>/api/v3`). */
  readonly apiUrl?: string;
  /** Added to the ticket's own labels. Defaults to `feedback`. */
  readonly labels?: readonly string[];
  readonly timeoutMs?: number;
}

const REFUSALS: Readonly<Record<number, (repo: string) => string>> = {
  401: () => 'GitHub refused the token (401): it is missing, expired or revoked.',
  403: repo => `GitHub denied access (403): the token may not create issues in ${repo}.`,
  404: repo => `GitHub cannot see ${repo} (404): check the repository name and the token's access.`,
  410: repo => `Issues are turned off in ${repo} (410).`,
};

async function messageOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const message = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['message'] : undefined;
    return typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : undefined;
  } catch { return undefined; }
}

/**
 * Opens one GitHub issue per ticket: `POST /repos/<owner>/<name>/issues` with the ticket's title, body and labels (plus `labels`). One
 * request, never retried: a refusal (401, 403, 404, 410, 422, any other status, no answer) is returned with a plain reason, and nothing
 * is filed twice by this sink.
 */
export function githubSink(options: GithubSinkOptions): TicketSink {
  const token = options.token;
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('A GitHub token is required');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const api = (options.apiUrl ?? GITHUB_API).replace(/\/+$/, '');
  const extra = options.labels ?? ['source:feedback'];
  const timeoutMs = options.timeoutMs ?? 30_000;
  return Object.freeze({
    name: 'github',
    accepts: (project: ProjectInfo) => ticketRepoOf(project) !== undefined,
    publish: async (ticket: Ticket, context: TicketSinkContext): Promise<TicketSinkResult> => {
      const repo = ticketRepoOf(context.project);
      if (!repo) return { refused: `The project "${context.project.name}" names no GitHub repository.` };
      const labels = [...new Set([...ticket.labels, ...extra])];
      const body = `${ticket.body}\n\n<!-- boring-ticket: ${ticket.id} -->\n`;
      const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${api}/repos/${repo}/issues`, {
          method: 'POST', signal,
          headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'boring-feedback-tickets' },
          body: JSON.stringify({ title: ticket.title, body, labels }),
        });
      } catch {
        return { refused: `GitHub did not answer; the issue may or may not exist in ${repo}: check before filing again.` };
      }
      if (response.status === 201) {
        let url: unknown;
        try { url = ((await response.json()) as Record<string, unknown>)['html_url']; } catch { url = undefined; }
        return typeof url === 'string' && /^https:\/\//.test(url) ? { url } : { refused: `GitHub created an issue in ${repo} but sent no link to it.` };
      }
      const known = REFUSALS[response.status];
      if (known) return { refused: known(repo) };
      if (response.status === 422) return { refused: `GitHub refused the issue (422)${await messageOf(response).then(message => message ? `: ${message}` : '')}.` };
      return { refused: `GitHub answered ${response.status}; nothing is known to be filed in ${repo}.` };
    },
  });
}

export interface FileSinkOptions {
  /** The viewer or share link of a ticket file. */
  readonly linkFor: (ticket: Ticket) => string;
}

/** The ticket file is the ticket: accepts every project and answers its link. */
export function fileSink(options: FileSinkOptions): TicketSink {
  return Object.freeze({
    name: 'file',
    accepts: () => true,
    publish: async (ticket: Ticket): Promise<TicketSinkResult> => ({ url: options.linkFor(ticket) }),
  });
}
