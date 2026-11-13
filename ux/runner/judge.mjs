// `judge`: Claude Opus, headless and read-only (Read and Glob only, no MCP), grades a captured folder against ux/CRITERIA.md and writes verdict.json and verdict.md next to it.
// It sees the pictures and the metrics, never the code or a worker's reasoning. This is the one command that calls a model; capture, check and site never do.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './build.mjs';

export const KEYS = ['clarity', 'layout', 'states', 'phone', 'polish', 'flows'];
export function judge({ folder, scenario, round = 0, prev, model = 'opus', evidence = '' }) {
  const template = readFileSync(join(root, 'ux/judge-prompt.md'), 'utf8');
  const prompt = `${template.replaceAll('{{TARGET}}', scenario.target)}\n\n## Paths for this run\n- CRITERIA: ${join(root, 'ux/CRITERIA.md')}\n- TARGET: ${scenario.target} (${scenario.title}): ${scenario.purpose}\n- Target-specific notes: ${scenario.notes ?? 'none'}\n- Round number: ${round}\n- FOLDER: ${folder}\n  (states in ${folder}/states, flows in ${folder}/flows/<id>/strip-<viewport>.png with ${folder}/flows/<id>/<viewport>/metrics.json, summary in ${folder}/result.json)\n`
    + (prev ? `- Previous round FOLDER: ${prev} (its verdict.json is there)\n` : '- Previous round: none (this is the baseline).\n')
    + (evidence ? `\n## Evidence from the loop's own measurements\nThe loop does not veto a round on these numbers; you weigh them inside the criterion they belong to (layout shift and settling under layout and states, touch targets under phone, steps that do not complete under flows). The numbers are noisy under machine load: trust a pattern across steps over one value.\n${evidence}\n` : '');
  for (const attempt of [1, 2]) {
    const out = spawnSync('claude', ['-p', '--model', model, '--tools', 'Read,Glob', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--add-dir', folder, '--add-dir', join(root, 'ux'), ...(prev ? ['--add-dir', prev] : [])],
      { input: prompt, encoding: 'utf8', cwd: folder, timeout: 60 * 60 * 1000, maxBuffer: 1 << 26 });
    const text = out.stdout || '';
    try {
      const verdict = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const wanted = KEYS.filter(k => scenario.criteria?.[k] !== false);
      if (!wanted.every(k => typeof verdict.grades?.[k] === 'number')) throw new Error('grades missing');
      writeFileSync(join(folder, 'verdict.json'), JSON.stringify(verdict, null, 2));
      writeFileSync(join(folder, 'verdict.md'), verdict.verdict_md ?? '');
      return verdict;
    } catch (error) { writeFileSync(join(folder, `judge-raw-${attempt}.txt`), `${error.message}\n${text}\n${out.stderr}`); }
  }
  return null;
}
