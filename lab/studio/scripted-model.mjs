// The scripted model: the deterministic layer of the studio gates. `createScriptedModel` from @hachej/boring-testing (the turn format is
// documented there and in packages/testing/README.md) answering from per-scenario and per-journey scripts instead of a real model, so a
// scenario's UI and runtime expectations (tool cards, artifacts, queue, stop, ask_user, subagents, git, reload, share links ...) run the
// same way every time. A failure in this layer is a bug, never model variance. Server side only: it is chosen by the host process
// (STUDIO_MODEL=scripted, or `startStudio({ scripted: true })`), never by anything the browser sends. See "Two test layers" in ./README.md.
//
// A scenario (./scenarios/*.mjs) or UI journey (./journeys/*.mjs) has `script`: an object from a key to the model's turns. The key is a
// step number ("0" is the prompt of steps[0]) or any text that appears in the user message it answers. The conversation's first user
// message names the scenario (or journey); the last user message names the key. "Reply with exactly: X" and number-essay prompts need no script.
import { createScriptedModel } from '@hachej/boring-testing/model';
export { answeredGenerically } from '@hachej/boring-testing/model';

/** Fictional rates (USD per million tokens), so a metered host has usage to charge. */
const RATES = { input: 0.25, output: 2, cacheRead: 0, cacheWrite: 0 };
const MODELS = [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }, { id: 'gpt-5-nano', name: 'GPT-5 nano' },
  // A costly fictional model: the studio's metered variant refuses it below a higher balance (model-aware admission).
  { id: 'premium', name: 'Premium (fictional)', cost: { input: 5, output: 40, cacheRead: 0, cacheWrite: 0 } }]
  .map(model => ({ input: ['text', 'image'], contextWindow: 128000, maxTokens: 4096, cost: RATES, ...model }));

/** The scripts of every scenario and journey, as `{ name, entries: [{ match, turns }] }`. */
export async function loadSources() {
  // Loaded here, not at the top: another host (the ambient example) uses this model with scripts of its own.
  const { loadScenarios } = await import('./scenarios/index.mjs');
  const { JOURNEYS } = await import('./journeys/index.mjs');
  const sources = [];
  for (const scenario of await loadScenarios()) {
    if (!scenario.script) continue;
    sources.push({ name: scenario.id, entries: Object.entries(scenario.script).map(([key, turns]) => {
      const step = /^\d+$/.test(key) ? scenario.steps[Number(key)] : undefined;
      if (/^\d+$/.test(key) && !step?.prompt) throw new Error(`Scenario ${scenario.id}: script key ${key} is not a prompt step`);
      return { match: step ? step.prompt : key, turns };
    }) });
  }
  for (const [name, journey] of Object.entries(JOURNEYS)) if (journey.script) sources.push({ name: `journey ${name}`, entries: Object.entries(journey.script).map(([match, turns]) => ({ match, turns })) });
  return sources;
}

/** Messages no script answered, across restarts of the host in one run. */
export const misses = [];

/** `sources`: `[{ name, entries: [{ match, turns }] }]`; the studio's scenario and journey scripts when absent. */
export async function createScriptedModels({ sources = undefined } = {}) {
  const { models } = createScriptedModel({ sources: sources ?? await loadSources(), models: MODELS, provider: 'openai', misses });
  return { models, misses };
}
