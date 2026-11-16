// Settle time is timing, and timing spikes when the machine is busy: the capture runs every flow in parallel beside the worker, and two captures of the same tree
// differed by more than 1.5x on 16 of 116 steps, each time on other steps. So a settle time that is over its threshold, or clearly worse than the last accepted round's,
// is measured again, alone, with the single-step probe (stable: five runs within 10%), and the median of the three is what is recorded and shown to the judge.
// Layout shift is deterministic and is left as captured. Bounded: at most MAX_FLOWS flow runs are re-measured per round, EXTRA_RUNS extra probes each (about 10-20 s each).
export const SPIKE = 1.5, MIN_GAP_MS = 150, MAX_FLOWS = 5, EXTRA_RUNS = 2;
export const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const stepsOf = (result, f) => (result?.flows ?? []).find(r => r.id === f.id && r.viewport === f.viewport)?.steps ?? [];

// The steps worth a second look, one entry per flow run, the slowest first.
export function suspects(result, prev, th) {
  const out = [];
  for (const f of result.flows) {
    const was = stepsOf(prev, f), idx = [];
    f.steps.forEach((s, i) => {
      if (!s.ok || typeof s.settledMs !== 'number') return;
      const b = was[i]?.settledMs, worse = typeof b === 'number' && s.settledMs > SPIKE * b && s.settledMs - b > MIN_GAP_MS;
      if (s.settledMs > th.settledMs || worse) idx.push(i);
    });
    if (idx.length) out.push({ id: f.id, viewport: f.viewport, idx, worst: Math.max(...idx.map(i => f.steps[i].settledMs)) });
  }
  return out.sort((a, b) => b.worst - a.worst);
}

// measure(flowId, viewport) -> the flow run measured alone. Edits `result` in place; returns what it re-measured.
export async function remeasure(result, prev, th, measure, { log = () => {}, maxFlows = MAX_FLOWS, extra = EXTRA_RUNS } = {}) {
  const all = suspects(result, prev, th), picked = all.slice(0, maxFlows), done = [];
  for (const g of picked) {
    const f = result.flows.find(r => r.id === g.id && r.viewport === g.viewport), runs = [];
    for (let k = 0; k < extra; k++) { try { runs.push((await measure(g.id, g.viewport)).steps); } catch (e) { log(`re-measure ${g.id}@${g.viewport}: ${e.message}`); break; } }
    if (!runs.length) continue;
    for (const i of g.idx) {
      const s = f.steps[i], alone = runs.map(r => r[i]).filter(x => x?.ok && typeof x.settledMs === 'number');
      if (!alone.length) continue;
      const settled = [s.settledMs, ...alone.map(x => x.settledMs)], first = [s.firstChangeMs, ...alone.map(x => x.firstChangeMs)].filter(x => typeof x === 'number');
      done.push(`${g.id}@${g.viewport}#${i + 1}: ${settled.join('/')} ms -> ${median(settled)}`);
      Object.assign(s, { settledMs: median(settled), ...(first.length ? { firstChangeMs: median(first) } : {}), remeasuredMs: settled });
    }
  }
  if (done.length) log(`settle re-measured alone (median of ${extra + 1}; ${picked.length} of ${all.length} flow runs, cap ${maxFlows}): ${done.join('; ')}`);
  return done;
}
