// Named corpus `synthetic-lines@1` for `test.line@1`. Fictional text only. Every step carries its full snapshot.
import { captureLine } from './line-adapter.mjs';

export const CORPUS_NAME = 'synthetic-lines@1';

const doc = (...lines) => ({ lines });
const base = doc('# Plan', 'alpha', 'beta', 'gamma', 'delta', 'epsilon');
const step = (name, snapshot, expect) => ({ name, snapshot, evaluated: `${name}:${snapshot.lines.length}`, expect });
const captured = (snapshot, index) => ({ snapshot, anchor: captureLine(snapshot, index) });

export const syntheticCorpus = [
  {
    name: 'unchanged and edits elsewhere',
    group: 'move',
    capture: captured(base, 2),
    steps: [
      step('same snapshot', base, { kind: 'exact', range: { line: 2 } }),
      step('later line edited', doc('# Plan', 'alpha', 'beta', 'gamma', 'delta', 'EPSILON'), { kind: 'exact', range: { line: 2 } }),
    ],
  },
  {
    name: 'block moved down',
    group: 'move',
    capture: captured(base, 2),
    steps: [
      step('block alpha-gamma after epsilon', doc('# Plan', 'delta', 'epsilon', 'alpha', 'beta', 'gamma'), { kind: 'moved', range: { line: 4 } }),
      step('lines inserted above', doc('# Plan', 'new one', 'new two', 'alpha', 'beta', 'gamma', 'delta', 'epsilon'), { kind: 'moved', range: { line: 4 } }),
    ],
  },
  {
    name: 'single line moved away from its neighbours',
    group: 'move',
    capture: captured(base, 2),
    steps: [
      step('beta alone at the end', doc('# Plan', 'alpha', 'gamma', 'delta', 'epsilon', 'beta'), { kind: 'ambiguous', candidates: [{ line: 5 }] }),
    ],
  },
  {
    name: 'block duplicated',
    group: 'duplicate',
    capture: captured(base, 2),
    steps: [
      step('alpha-gamma pasted twice', doc('# Plan', 'alpha', 'beta', 'gamma', 'delta', 'alpha', 'beta', 'gamma', 'epsilon'), { kind: 'ambiguous', candidates: [{ line: 2 }, { line: 6 }] }),
      step('far copy only differs by a neighbour', doc('# Plan', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'x', 'beta', 'y'), { kind: 'exact', range: { line: 2 } }),
    ],
  },
  {
    name: 'repeated line captured',
    group: 'duplicate',
    capture: captured(doc('- item', '- item', '- item'), 1),
    steps: [
      step('one more item appended', doc('- item', '- item', '- item', '- item'), { kind: 'ambiguous', candidates: [{ line: 0 }, { line: 1 }, { line: 2 }, { line: 3 }] }),
    ],
  },
  {
    name: 'line deleted',
    group: 'delete',
    capture: captured(base, 3),
    steps: [
      step('gamma removed', doc('# Plan', 'alpha', 'beta', 'delta', 'epsilon'), { kind: 'missing' }),
      step('everything removed', doc(), { kind: 'missing' }),
    ],
  },
  {
    name: 'deleted then similar text added',
    group: 'deletion-then-similar',
    capture: captured(doc('Total: 42', 'Paid: 40', 'Due: 2'), 0),
    steps: [
      step('total rewritten', doc('Total: 43', 'Paid: 40', 'Due: 3'), { kind: 'missing' }),
      step('case and spacing changed', doc('total: 42 ', 'Paid: 40', 'Due: 2'), { kind: 'missing' }),
    ],
  },
  {
    name: 'same text reused in a new context',
    group: 'reused-identity',
    capture: captured(base, 2),
    steps: [
      step('beta deleted then re-added elsewhere', doc('# Plan', 'alpha', 'gamma', 'delta', 'other', 'beta', 'tail'), { kind: 'ambiguous', candidates: [{ line: 5 }] }),
      step('section rewritten around reused text', doc('# Other', 'one', 'beta', 'two'), { kind: 'ambiguous', candidates: [{ line: 2 }] }),
    ],
  },
  {
    name: 'uninstalled paragraph kind',
    group: 'unknown-kind',
    capture: { snapshot: base, anchor: { kind: 'test.paragraph@2', paragraph: 3, quote: 'gamma', fallback: 'Paragraph 4 starting "gamma"' } },
    steps: [
      step('placed as unsupported', base, { kind: 'unsupported' }),
    ],
  },
  {
    name: 'future version of the line kind',
    group: 'unknown-kind',
    capture: { snapshot: base, anchor: { kind: 'test.line@2', text: 'beta', column: 1, fallback: 'Line 3: "beta"' } },
    steps: [
      step('placed as unsupported', base, { kind: 'unsupported' }),
    ],
  },
];
