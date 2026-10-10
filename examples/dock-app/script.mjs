// The scripted model's side of the dock-app journey (format: ../studio/scripted-model.mjs): what the model answers to each prompt,
// so the journey runs the same way every time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
export const SOURCES = [{ name: 'dock-app', entries: Object.entries({
  'journal': ['Three entries this week: a market visit, a long walk and a new recipe.'],
}).map(([match, turns]) => ({ match, turns })) }];
