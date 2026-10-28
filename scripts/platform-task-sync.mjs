#!/usr/bin/env node
// Ties a pull request of a platform repository (hachej/boring-factory, hachej/boring-ui) to its task in the platform's task space (`factory`, `ui`; tasks/src/spaces.mjs).
// Run by .github/workflows/platform-tasks.yml on pull_request_target, same-repository pull requests only. The same file is copied to hachej/boring-ui (.github/scripts/).
//
// The task is named by the branch (`d-<n>-slug`, `task/D-<n>`, `task/<uuid>`) or by a line of the body (`Task: D-<n>`, several allowed). A pull request that names none, or
// a task the space does not have, is left alone (a warning, never a failure). Then, with the narrow `ci` credential of the tasks Worker (PLATFORM_TASKS_TOKEN):
//   opened, reopened, ready for review -> the task is working, with the pull request in its history
//   merged                             -> the task is done by merge (a record: no build, no ship)
//   closed unmerged                    -> the task is open again, unless another of its pull requests is still open
// Zero dependencies, never prints the token or the pull request's text. Exit 0 whatever the store says: a pull request is never blocked by its task.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const MAX_REFS = 5;

/** The tasks a pull request names, as { number } or { id }, in order, without repeats. */
export function refsOf({ branch = '', body = '' }) {
  const refs = [];
  const add = (ref) => { if (!refs.some((r) => r.number === ref.number && r.id === ref.id)) refs.push(ref); };
  const uuidBranch = /^task\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|\/|$)/i.exec(branch);
  const fromBranch = uuidBranch ? null : /^d-(\d{1,9})(?:-|$)/i.exec(branch) ?? /^task\/(?:d-)?(\d{1,9})(?:-|\/|$)/i.exec(branch);
  if (uuidBranch) add({ id: uuidBranch[1].toLowerCase() });
  if (fromBranch) add({ number: Number(fromBranch[1]) });
  for (const line of String(body).split(/\r?\n/)) {
    const match = /^\s*Task:\s*(.+)$/i.exec(line);
    if (!match) continue;
    for (const part of match[1].split(/[,\s]+/)) {
      const number = /^D-(\d{1,9})$/i.exec(part);
      if (number) add({ number: Number(number[1]) });
      else if (UUID.test(part) && part.length === 36) add({ id: part.toLowerCase() });
    }
  }
  return refs.slice(0, MAX_REFS);
}

/** The event to record for a pull_request payload, or null (an action that changes nothing). */
export function eventOf(payload) {
  const pr = payload?.pull_request;
  if (!pr) return null;
  switch (payload.action) {
    case 'opened': case 'reopened': case 'ready_for_review': return 'opened';
    case 'edited': return pr.state === 'open' && !pr.merged ? 'opened' : null;
    case 'closed': return pr.merged ? 'merged' : 'closed';
    default: return null;
  }
}

/** Records the pull request on its tasks. Returns the lines to log. */
export async function sync({ payload, space, url, token, repository, fetcher = fetch }) {
  const log = [];
  const pr = payload?.pull_request;
  const event = eventOf(payload);
  if (!event) return ['nothing to record for this action'];
  // A fork's pull request, or one from another repository, never touches a task.
  if (pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) return ['pull request from another repository: left alone'];
  const refs = refsOf({ branch: pr.head?.ref ?? '', body: pr.body ?? '' });
  if (!refs.length) return ['no task named (branch d-<n>-..., or a line "Task: D-<n>"): left alone'];
  if (!token) return ['::warning::PLATFORM_TASKS_TOKEN is not set: the task is not updated'];
  const call = async (path, body) => {
    const response = await fetcher(new URL(path, url), { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  const listed = await call(`/repos/boring-next/${space}/tasks`);
  if (listed.status !== 200) return [`::warning::cannot list the ${space} space (HTTP ${listed.status}): the task is not updated`];
  for (const ref of refs) {
    const label = ref.number ? `D-${ref.number}` : ref.id;
    const task = listed.data.tasks?.find((t) => (ref.number ? t.number === ref.number : t.id === ref.id));
    if (!task) { log.push(`::warning::${label} is not a task of the ${space} space: left alone`); continue; }
    const done = await call(`/tasks/${task.id}/pr`, { event, pr: pr.html_url, ...(pr.head?.ref && /^[\w./-]{1,200}$/.test(pr.head.ref) ? { branch: pr.head.ref } : {}) });
    // 409: the task is already done or closed, which is the end of its story, not a failure of the pull request.
    log.push(done.status === 200 ? `${label}: pull request ${event}, the task is ${done.data.task?.state ?? '?'}` : done.status === 409 ? `${label}: already ${task.state ?? 'closed'}, left as it is` : `::warning::${label}: the task store answered ${done.status}`);
  }
  return log;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY, PLATFORM_TASKS_SPACE, PLATFORM_TASKS_URL, PLATFORM_TASKS_TOKEN } = process.env;
  const payload = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'));
  const lines = await sync({ payload, space: PLATFORM_TASKS_SPACE, url: PLATFORM_TASKS_URL, token: PLATFORM_TASKS_TOKEN, repository: GITHUB_REPOSITORY }).catch(() => ['::warning::the task store did not answer: the task is not updated']);
  for (const line of lines) console.log(line);
}
