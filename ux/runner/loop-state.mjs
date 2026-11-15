// The decisions of the UX loop that need no model, browser or git, so a test can drive them with a fake worker and a fake judge:
// which criterion a round targets, what was already tried, when to rethink, when to pause, the pid guard and status.json.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const STALL = 2, RETHINK_AFTER = 3, PAUSE_AFTER = 8, PAUSE_HOURS = [6, 12, 24], MAX_FILES = 8;
const num = v => typeof v === 'number';

// Done only when every graded criterion is 9 or more.
export const allNine = (grades, keys) => keys.every(k => grades?.[k] === undefined || grades[k] >= 9);

// The criterion this round works on: the lowest one that has not stalled (STALL rounds in a row without a gain on it). When all stalled, the one tried least
// (fewest misses, then lowest grade), so the turn passes round the criteria instead of returning to the lowest one for ever.
export function pickFocus(grades, keys, misses = {}) {
  const open = keys.filter(k => num(grades?.[k]) && grades[k] < 9);
  if (!open.length) return null;
  const live = open.filter(k => (misses[k] ?? 0) < STALL), pool = live.length ? live : open, tried = k => (live.length ? 0 : misses[k] ?? 0);
  return [...pool].sort((a, b) => tried(a) - tried(b) || grades[a] - grades[b] || keys.indexOf(a) - keys.indexOf(b))[0];
}
// A round that targeted `focus` and did not raise it counts as a miss; a gain clears the count.
export function updateMisses(misses, focus, before, after) {
  const next = { ...misses };
  if (!focus) return next;
  next[focus] = num(after?.[focus]) && after[focus] > (before?.[focus] ?? 0) ? 0 : (next[focus] ?? 0) + 1;
  return next;
}

// After RETHINK_AFTER rounds in a row with nothing accepted, the next round is a rethink round.
export const rethinkDue = failedInRow => failedInRow >= RETHINK_AFTER;
// The advisor runs once per stuck episode (an accepted round or a pause ends the episode) and at most once every ADVISE_GAP rounds, on the round that is due to rethink.
export const ADVISE_GAP = 3;
export const advisorDue = ({ failedInRow, advisedThisEpisode, round, lastAdvisedRound }) => rethinkDue(failedInRow) && !advisedThisEpisode && (lastAdvisedRound === null || round - lastAdvisedRound >= ADVISE_GAP);
// The last attempts that did not gain, one line each, for the advisor.
export const triedRecent = (all, n = 8) => all.filter(t => t.result !== 'accepted').slice(-n).map(t => `- round ${t.round} on ${t.criterion} (${t.result}): ${t.note}`).join('\n') || 'nothing yet';
export const pauseDue = failedInRow => failedInRow >= PAUSE_AFTER;
export const pauseHours = pauses => PAUSE_HOURS[Math.min(pauses, PAUSE_HOURS.length - 1)];

// One line per attempt on a criterion (kept in tried.json): the round, its result, what the worker changed or why it failed.
export const oneLine = t => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
export function addTried(file, entry) {
  const all = readTried(file); all.push({ ...entry, note: oneLine(entry.note) }); writeFileSync(file, JSON.stringify(all, null, 1)); return all;
}
export const readTried = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; } };
export const triedText = (all, focus) => {
  const mine = all.filter(t => t.criterion === focus).slice(-12);
  return mine.length ? mine.map(t => `- round ${t.round} (${t.result}): ${t.note}`).join('\n') : 'nothing yet on this criterion';
};
// The first bullet of the worker's changes.md, as the one-line "what was tried".
export const firstChange = md => oneLine((String(md ?? '').split('\n').find(l => /^\s*[-*]\s+\S/.test(l)) ?? md).replace(/^\s*[-*]\s+/, ''));

// More than `max` files edited outside tests: the round is too big, discarded without a repair.
export const isTest = f => /^test\//.test(f) || /\.test\.[mc]?[jt]sx?$/.test(f);
export const overCap = (changed, max = MAX_FILES) => { const n = changed.filter(f => !isTest(f)).length; return n > max ? [`the round touched ${n} files outside tests (the cap is ${max}): one focused change, a handful of files`] : []; };

// One loop per state folder: a pid file checked by pid (and by the process still being this loop), never by a name search.
export function alive(pid, cmdline = p => { try { return readFileSync(`/proc/${p}/cmdline`, 'utf8'); } catch { return null; } }) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  const c = cmdline(pid); return c === null || /loop\.mjs/.test(c);
}
export function claimPid(file, { pid = process.pid, isAlive = alive } = {}) {
  if (existsSync(file)) { const other = Number(readFileSync(file, 'utf8').trim()); if (other !== pid && isAlive(other)) return { ok: false, pid: other }; }
  writeFileSync(file, `${pid}\n`); return { ok: true, pid };
}
export const releasePid = (file, pid = process.pid) => { try { if (Number(readFileSync(file, 'utf8').trim()) === pid) rmSync(file, { force: true }); } catch { /* gone */ } };

// status.json: cheap to read, rewritten at every step.
export function writeStatus(file, s, now = () => new Date()) {
  let old = {}; try { old = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first write */ }
  const t = now().toISOString(), next = { ...old, ...s, startedAt: old.startedAt ?? t };
  if (old.state !== next.state || old.round !== next.round || old.focus !== next.focus || old.failedInRow !== next.failedInRow) next.lastChangeAt = t; else next.lastChangeAt = old.lastChangeAt ?? t;
  writeFileSync(file, JSON.stringify(next, null, 1)); return next;
}

// Sleep in short steps so STOP ends a pause at once. Returns 'stop' or 'woke'.
export async function pauseFor(ms, { stopped, sleep = m => new Promise(r => setTimeout(r, m)), step = 30000 }) {
  for (let left = ms; left > 0; left -= step) { if (stopped()) return 'stop'; await sleep(Math.min(step, left)); }
  return stopped() ? 'stop' : 'woke';
}

// What a round tells the worker about its focus, what was tried, and (after repeated failures) to rethink.
export function focusBrief({ focus, problems = [], raise = '', blockers = [], tried, rethink, failures = '', advisor = '', max = MAX_FILES }) {
  const probs = problems.length ? problems.slice(0, 3).map(p => `- ${p.problem} (where: ${p.where}; fixed looks like: ${p.fixed_looks_like})`).join('\n') : '- (the judge listed none; read verdict.md)';
  if (advisor) return `## The advisor's plan (Opus read the loop's state and the code after several discarded rounds): this is your instruction for this round. Follow it: one focused change, at most ${max} files outside tests.\n${advisor}\n\n## The judge's notes on ${focus}, for reference\n${probs}\n${raise ? `\n${raise}\n` : ''}\n## Already tried (do NOT repeat)\n${tried}\n`;
  return `## This round's single target: ${focus ?? 'none'}\nWork on this ONE criterion: one focused change, at most ${max} files outside tests (more and the round is discarded). Leave the other criteria alone unless they are a regression.\nThe judge's notes on it:\n${probs}\n${raise ? `\nWhat would raise it, and what a 9 still needs (the judge's words):\n${raise}\n` : ''}${blockers.length ? `\nThe worst measured numbers of the whole capture (they hold several grades down at once, whatever the criterion; if one fits this criterion, it comes first):\n${blockers.map(b => `- ${b}`).join('\n')}\n` : ''}\n## Already tried on ${focus} (do NOT repeat these; try something different, or a different part of the screen)\n${tried}\n`
    + (rethink ? `\n## Rethink round\nThe last rounds in a row were discarded. Their exact failure text is below. Propose a SMALLER and DIFFERENT change than the ones that failed: fewer files, one idea, nothing that touches what failed.\n${failures}\n` : '');
}
