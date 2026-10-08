// The scripted model's side of the workspace-app journey (format: ../studio/scripted-model.mjs): what the model answers to each prompt,
// so the journey runs the same way every time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
const call = (name, args) => ({ tools: [{ name, args }] });
const NOTES = '# Picnic plan\n\nA fictional picnic by the invented Lake Placeholder.\n\n- Blanket and baskets\n- Lemonade\n';

export const SOURCES = [{ name: 'workspace-app', entries: Object.entries({
  'picnic plan': [call('write', { path: 'picnic-plan.md', content: NOTES }), call('present', { path: 'picnic-plan.md' }), 'The picnic plan is ready.'],
}).map(([match, turns]) => ({ match, turns })) }];
