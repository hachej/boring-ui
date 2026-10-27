import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// A strict copied-source consumer, including the actual host Base UI components and every declared registry sibling.
test('task-board installed registry source exposes strict consumer types', () => {
  const parent = resolve('.cache/task-board-consumer'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'consumer-'));
  try {
    const seen = new Set();
    const install = name => {
      if (seen.has(name)) return; seen.add(name);
      const item = JSON.parse(readFileSync(resolve('public/r', name + '.json'), 'utf8'));
      for (const file of item.files ?? []) { const target = join(directory, file.target); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, file.content); }
      for (const dependency of item.registryDependencies ?? []) install(dependency.split('/').at(-1).replace(/\.json$/, ''));
    };
    install('task-board');
    cpSync(resolve('examples/app-shell/components/ui'), join(directory, 'components/ui'), { recursive: true });
    cpSync(resolve('examples/app-shell/lib'), join(directory, 'lib'), { recursive: true });
    cpSync(resolve('examples/app-shell/hooks'), join(directory, 'hooks'), { recursive: true });
    writeFileSync(join(directory, 'consumer.tsx'), `import { TaskBoard, TaskDetail, TASK_STATES, defaultTaskBoardLabels } from './components/task-board/task-board';
import type { TaskCard, TaskSource, TaskLayout, TaskState, TaskBoardProps, TaskDetailProps, TaskBoardLabels } from './components/task-board/task-board';
const state: TaskState = TASK_STATES[0];
const task: TaskCard = { id: 'D-1', title: 'Fictional task', state, createdBy: 'coordinator', children: { done: 1, total: 2 }, waiting_on: { who: 'coordinator', question: 'Ready?' }, spec: '**Safe**', history: [{ at: '2026-10-20', text: 'Created' }] };
const source: TaskSource = { list: async () => [task], subscribe: cb => { cb([task]); return () => {}; } };
const layout: TaskLayout = 'sections';
const labels: Partial<TaskBoardLabels> = { ...defaultTaskBoardLabels, count: n => String(n) };
const board: TaskBoardProps = { tasks: [task], layout, onOpen: task => void task.title, onLayoutChange: next => void next, renderCard: task => <span>{task.id}</span>, labels };
const detail: TaskDetailProps = { task, labels: { specification: 'Spec', markdown: { copyCode: 'Copier' } } };
const view = <><TaskBoard {...board} /><TaskDetail {...detail} /></>;
// @ts-expect-error Business state vocabulary is closed.
const wrongState: TaskCard = { id: 'bad', title: 'bad', state: 'pending' };
// @ts-expect-error The host receives the task, not a string or an untyped event.
const wrongOpen: TaskBoardProps = { tasks: [], onOpen: (id: string) => {} };
void [source, view, wrongState, wrongOpen];
`);
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2023', 'DOM'], jsx: 'react-jsx', strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true, types: ['react', 'react-dom'], baseUrl: '.', paths: { '@/*': ['./*'] } }, include: ['consumer.tsx'] }));
    const result = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')], { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
