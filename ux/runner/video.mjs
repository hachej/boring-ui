// Video of one flow: the ONE function that records. Narrow on purpose, so another recorder (captions, a visible pointer, MP4) can replace it
// without touching a scenario:   recordFlow({ scenario, flowId, viewport, outDir }) -> { files: [absolute paths], ok: boolean }
// This one replays the flow at the live pace (`pace=real`) with the browser's own recording (WebM, no overlay) into <outDir>/<flowId>-<viewport>.webm.
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { open, step } from './capture.mjs';
import { snap } from './measure.mjs';
import { pick } from './gestures.mjs';

export async function recordFlow({ scenario: s, flowId, viewport, outDir, browser }) {
  const vp = s.viewports.find(v => v.name === String(viewport)), f = s.flows.find(x => x.id === flowId);
  if (!vp || !f) throw new Error(`no flow ${flowId} at ${viewport} in ${s.target}`);
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, `.${flowId}-${vp.name}`);
  const h = await open(browser, s, vp, f.query, { fast: false, video: tmp });
  const ctx = { before: await h.page.evaluate(snap(s.watch)) };
  let ok = true;
  for (const def of f.steps) { if ((def.only && String(def.only) !== vp.name) || (def.skip && String(def.skip) === vp.name)) continue; ok = (await step(h, s, def, ctx)).ok && ok; }
  await h.page.waitForTimeout(600);
  const video = h.page.video(); await h.ctx.close();
  const file = join(outDir, `${flowId}-${vp.name}.webm`);
  renameSync(await video.path(), file);
  return { files: [file], ok };
}
