import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Experience } from '@hachej/boring-ui-kit/experience';
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';

const cells = [{ ref: 'fictional/notes', kind: 'notes', version: 1,
  render: () => createElement('article', null, 'Fictional host-owned document content') }];
const canView = ref => ref === 'fictional/notes';
const descriptor = validateExperience({
  format: 'boring.experience', version: 1, name: 'preparation', source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/cell': 1, notes: 1 }, root: 'page',
  elements: {
    page: { type: 'boring/stack', props: { gap: 'medium' }, children: ['notes'] },
    notes: { type: 'boring/cell', props: { ref: 'fictional/notes' } },
  },
}, { cells, canView });
console.log(renderToStaticMarkup(createElement('main', null,
  createElement('h1', null, 'Fictional host application'),
  createElement(Experience, { descriptor, cells, canView }))));
