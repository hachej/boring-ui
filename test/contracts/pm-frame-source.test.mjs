import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('an embedded workspace keeps its bar above the viewer, even when its frame is the whole window', () => {
  assert.match(read('registry/pi-app/agent-workspace.tsx'), /contained=\{embedded\}/);
  assert.match(read('registry/pi-workspace/workspace.tsx'), /sheet \? \(!contained && size >= window\.innerWidth - 1 \? 'fixed inset-0 z-50' : 'absolute inset-0 z-50'\)/);
});

test('a framed PM names itself in the bar and tells its host about pointing', () => {
  assert.match(read('registry/pm-panel/pm-panel.tsx'), /title=\{window\.parent === window \? undefined : 'PM'\}/);
  const frames = read('registry/pm-panel/point-frames.ts');
  assert.match(frames, /tellHost\('pm-pointing', picking\)/);
  assert.match(frames, /tellHost\('pm-picked'\)/);
});

test('the door reads the resource address from the descriptor', () => {
  const door = read('registry/pm-panel/use-improve-agent.ts');
  assert.match(door, /descriptor\['resources'\]/);
  assert.doesNotMatch(door, /`\$\{base\}\/library`/);
});
