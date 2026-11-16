import type { Principal } from '@earendil-works/chord';
import * as Layer from 'effect/Layer';
import { defineApp, type Scope } from '@hachej/boring-agent/host';
import notes from '../../fixtures/host-apps/notes/app.ts';
import todo from '../../fixtures/host-apps/todo/app.ts';

export const both = [notes, todo];

export const scopeIsAPrincipal = (scope: Scope): Principal => scope;

const words = { app: { title: 'Exemple' }, views: { v: 'Vue' }, refusals: {} };
const ok = {
  name: 'sample', languages: { base: 'fr', words: { fr: words } }, models: [], handlers: Layer.empty, api: {},
  expose: { page: ['A'] }, views: [{ id: 'v', component: './v.tsx' }],
} as const;

export const seedWithoutOperations = defineApp({ ...ok, seed: { people: [{ name: 'Camille Test', email: 'camille@example.test' }] } });

// @ts-expect-error A view carries its component.
export const noComponent = defineApp({ ...ok, views: [{ id: 'v' }] });
// @ts-expect-error A view has no rightPane.
export const rightPane = defineApp({ ...ok, views: [{ id: 'v', component: './v.tsx', rightPane: 'x' }] });
// @ts-expect-error The model is the kit's, not the definition's.
export const withModel = defineApp({ ...ok, model: { provider: 'p', modelId: 'm' } });
// @ts-expect-error `mail` is not a capability yet.
export const needsMail = defineApp({ ...ok, needs: ['mail'] });
// @ts-expect-error An agent comes from defineAgent.
export const fakeAgent = defineApp({ ...ok, agents: () => ({ assistant: { id: 'x' } }) });
// @ts-expect-error The title is a word of the base language, not a field.
export const withTitle = defineApp({ ...ok, title: 'Exemple' });
// @ts-expect-error A language the kit does not speak.
export const unknownLanguage = defineApp({ ...ok, languages: { base: 'xx', words: { xx: words } } });
// @ts-expect-error A view has no nav: its name is a word of the base language.
export const withNav = defineApp({ ...ok, views: [{ id: 'v', component: './v.tsx', nav: 'Vue' }] });
