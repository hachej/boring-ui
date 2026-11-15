// The advisor: when the loop is stuck, Claude Opus (headless on the subscription: `claude -p`, read-only tools, no MCP, never an API key) reads the state of the
// loop and the kit source once, and writes ONE plan for the worker: the change most likely to raise a score, its root cause in the code, the approach, what to leave alone.
// It writes no code. A failure or a timeout returns null and the round goes on as a plain rethink round.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADVISOR_TIMEOUT_MS = 10 * 60 * 1000;
const clip = (t, n) => String(t ?? '').slice(-n);

export function advisorPrompt({ scenario, verdict, scoreboard, tried, failures, folder, home, root }) {
  const raise = Object.entries(verdict?.to_raise ?? {}).map(([k, t]) => `- ${k}: ${t}`).join('\n') || '(the judge gave none)';
  return `You are a senior product designer and front-end engineer advising a worker agent (Codex) in a UX improvement loop. The loop has been stuck: several rounds in a row were discarded because no grade rose. You write no code and edit nothing; you read, then give ONE plan.

Target: ${scenario.target} (${scenario.title}): ${scenario.purpose}
Goal: every criterion at 9 (ux/CRITERIA.md in the repo says what 9 means; a grade is capped by its worst state or flow).

## Read first
- The repo to read is the current directory (the kit source: registry/, ux/scenarios/, ux/CRITERIA.md, features/). The scenario: ${scenario.file}.
- The latest accepted capture (pictures and metrics; open the ones the notes name): ${folder} (states/*.png, flows/<id>/strip-<viewport>.png, flows/<id>/<viewport>/metrics.json, verdict.json, verdict.md).
- The scoreboard file: ${join(home, 'scoreboard.md')}

## Grades now
${JSON.stringify(verdict?.grades ?? {})}

## What the judge says would raise each criterion
${raise}

## The three worst measurements
${(verdict?.worst_numbers ?? []).slice(0, 3).map(w => `- ${w}`).join('\n') || '(none)'}

## Scoreboard (tail)
${clip(scoreboard, 3500)}

## What the last rounds tried (and how each ended)
${tried}

## Why the last rounds were discarded
${clip(failures, 3000)}

## Your answer
Plain Markdown, at most 400 words, exactly these four headings:
1. **The change**: the single change most likely to raise a score, stated as an observable result (a number or a picture).
2. **Root cause in the code**: the files (paths) and why, as you read them. Verify it in the source; do not guess.
3. **Approach**: the steps the worker should take, smallest first.
4. **Leave alone**: what the worker must not touch or repeat, and why.
Do not propose a redesign of the product, new components outside the kit, or changes to the harness, scenario or criteria.`;
}

export function advise({ scenario, verdict, tried, failures, folder, home, root, out, run = spawnSync, timeout = ADVISOR_TIMEOUT_MS }) {
  const file = join(home, 'scoreboard.md'), prompt = advisorPrompt({ scenario, verdict, scoreboard: existsSync(file) ? readFileSync(file, 'utf8') : '', tried, failures, folder, home, root });
  const r = run('claude', ['-p', '--model', 'opus', '--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--add-dir', folder, '--add-dir', home],
    { input: prompt, encoding: 'utf8', cwd: root, timeout, maxBuffer: 1 << 26 });
  const text = String(r.stdout ?? '').trim();
  if (r.status !== 0 || r.error || text.length < 80) return { plan: null, why: r.error?.code === 'ETIMEDOUT' ? `timed out after ${Math.round(timeout / 60000)} min` : `exit ${r.status}${r.error ? ` ${r.error.message}` : ''}: ${clip(r.stderr || text, 200).replace(/\s+/g, ' ')}` };
  writeFileSync(out, `${text}\n`); return { plan: text };
}
