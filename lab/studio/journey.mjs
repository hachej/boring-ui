// Real-browser, real-model journey for the studio. Needs CHROMIUM and a provider key (OPENAI_API_KEY by default).
// It executes the scenario files (./scenarios/*.mjs) through the real UI for each selected variant, plus a few UI journeys
// (./journeys/*.mjs) for what is not scenario-shaped.
//   STUDIO_VARIANT=local|vercel|local,vercel|all   which variants to run (default local)
//   STUDIO_ONLY=<scenario ids, group names or UI journey names, comma separated>
//   STUDIO_MODEL=scripted   the scripted layer: a deterministic model driven by the scenarios' `script`s (no key, no retries, blocking in CI)
//   STUDIO_SMOKE=1    the smoke layer: only the scenarios marked `smoke: true`, against the real model, retries allowed (STUDIO_RETRIES, default 2),
//                     prints a pass rate and exits 0 unless it is below STUDIO_SMOKE_MIN (default 0.6). Never blocking.
//   STUDIO_SECURE=1   debugging: 127.0.0.1 (a secure context) instead of the default insecure origin
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';
import { insecureUrl, launch, q, qa } from '@hachej/boring-testing/browser';
import { JOURNEYS } from './journeys/index.mjs';
import { createToolkit } from './journey-toolkit.mjs';
import { applicable, expectations, runScenario } from './journey-scenarios.mjs';
import { unavailableReason } from './scenario-availability.mjs';

const evidence = process.env.STUDIO_EVIDENCE ?? '.cache/evidence/studio';
mkdirSync(evidence, { recursive: true });
const directory = process.env.STUDIO_DATA ?? mkdtempSync(join(tmpdir(), 'boring-studio-'));
// Flags for the package scripts: `--scripted` (the deterministic layer) and `--smoke` (the real-model smoke layer).
if (process.argv.includes('--scripted')) process.env.STUDIO_MODEL = 'scripted';
if (process.argv.includes('--smoke')) process.env.STUDIO_SMOKE = '1';
const steps = [];
const smoke = process.env.STUDIO_SMOKE === '1';
const scripted = process.env.STUDIO_MODEL === 'scripted';
assert.ok(!(smoke && scripted), 'The smoke layer uses the real model: unset STUDIO_MODEL');
const retries = scripted ? 0 : Number(process.env.STUDIO_RETRIES ?? (smoke ? 2 : 1));
const smokeResults = [];
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let app = await startStudio({ directory, port: 0 });
const port = app.port, token = app.token;
let browser;
try {
  const wanted = (process.env.STUDIO_VARIANT ?? 'local') === 'all' ? app.variants().filter(variant => variant.available).map(variant => variant.id) : (process.env.STUDIO_VARIANT ?? 'local').split(',');
  const only = process.env.STUDIO_ONLY?.split(',').map(item => item.trim()).filter(Boolean);
  const selected = (id, group) => !only || only.includes(id) || (group !== undefined && only.includes(slug(group)));
  // Strict by default: the page is an insecure context, like the plain-HTTP private address the studio is opened on in practice.
  const pageUrl = process.env.STUDIO_SECURE === '1' ? app.url : insecureUrl(app.url);
  browser = await launch(pageUrl, { evidence });
  if (process.env.STUDIO_SECURE !== '1') await step('environment: the page is an insecure context without randomUUID, subtle crypto, clipboard and share', async () => {
    await browser.until('page loaded', `location.origin.startsWith('http') && document.readyState !== 'loading'`);
    const env = await browser.evaluate(`({ secure: window.isSecureContext, uuid: typeof crypto.randomUUID, subtle: typeof crypto.subtle, clipboard: typeof navigator.clipboard, share: typeof navigator.share, origin: location.origin })`);
    assert.deepEqual({ ...env, origin: undefined }, { secure: false, uuid: 'undefined', subtle: 'undefined', clipboard: 'undefined', share: 'undefined', origin: undefined }, `journeys must run on an insecure origin (got ${env.origin})`);
  });

  let shown = 'local';
  const authorize = request => {
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${token}`); headers.set('x-studio-variant', shown);
    return fetch(new Request(request, { headers }));
  };
  const t = createToolkit({ browser, pageUrl, step, app: () => app, base: app.url, authorize,
    // A full restart of the studio on the same data directory: the browser notices it lost the server, the new process resumes the sessions.
    restartHost: async () => {
      await app.close();
      await browser.until('the browser notices it lost the server', `${q('[data-testid=connection]')}?.dataset.state !== 'connected'`, 15000);
      app = await startStudio({ directory, port, token });
    } });
  t.variantId = () => shown;
  /** Chooses a variant in the header selector, as a person does, and waits for its chat. */
  t.selectVariant = async id => {
    await t.ready();
    await browser.evaluate(`(() => { const select = ${q('[data-testid=variant-select]')}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(id)}); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await browser.until(`the ${id} variant is shown`, `document.querySelector('.studio')?.dataset.variant === ${JSON.stringify(id)} && ${t.connected}`, 30000);
    shown = id;
  };

  // The variant selector: every variant is listed, the unavailable ones disabled with their reason, the choice kept for the session.
  await step('variants: all are listed, unavailable ones are disabled with a reason, the choice survives a reload', async () => {
    await t.ready();
    const listed = await browser.evaluate(`${qa('[data-testid=variant-select] option')}.map(option => ({ value: option.value, disabled: option.disabled, title: option.title }))`);
    assert.deepEqual(listed.map(item => item.value), app.variants().map(variant => variant.id));
    for (const variant of app.variants()) {
      const item = listed.find(candidate => candidate.value === variant.id);
      assert.equal(item.disabled, !variant.available, `${variant.id} availability`);
      if (!variant.available) assert.ok(item.title.length > 10, `${variant.id} says why it is unavailable`);
    }
    await t.selectVariant('local');
    await t.reload();
    assert.equal(await browser.evaluate(`document.querySelector('.studio').dataset.variant`), 'local');
  });

  if (!smoke) for (const [name, journey] of Object.entries(JOURNEYS)) if (selected(name)) await journey(t);

  const scenarios = app.scenarios();
  for (const id of wanted) {
    const variant = app.variants().find(candidate => candidate.id === id);
    if (!variant?.available) { console.log(`skip variant ${id}: ${variant ? variant.reason : 'unknown'}`); continue; }
    await t.selectVariant(id);
    await step(`${id}: scenarios the variant cannot run are listed disabled, with the reason`, async () => {
      await t.fresh();
      for (const scenario of scenarios.filter(candidate => !applicable(candidate, variant))) {
        const reason = unavailableReason(scenario, variant, app.variants());
        const row = `[data-testid=scenario][data-scenario=${scenario.id}]`;
        await browser.until(`${scenario.id} is listed`, `!!${q(row)}`, 20000);
        assert.equal(await browser.evaluate(`${q(row)}.disabled`), true, `${scenario.id} is disabled on ${id}`);
        assert.equal(await browser.evaluate(`${q(row)}.querySelector('[data-testid=scenario-reason]')?.textContent`), reason);
      }
    });
    for (const scenario of scenarios) {
      if (!selected(scenario.id, scenario.group) || (smoke && !scenario.smoke)) continue;
      if (!applicable(scenario, variant)) { console.log(`skip ${scenario.id} on ${id}: ${unavailableReason(scenario, variant, app.variants())}`); continue; }
      if (!smoke) { await runScenario(t, scenario, variant, expectations, { retries }); continue; }
      // Smoke: a failure is recorded, not fatal; the rate is what is reported.
      try { await runScenario(t, scenario, variant, expectations, { retries }); smokeResults.push({ id: scenario.id, passed: true }); }
      catch (error) { smokeResults.push({ id: scenario.id, passed: false, error: String(error.message).split('\n')[0].slice(0, 300) }); console.log(`FAIL ${scenario.id}: ${smokeResults.at(-1).error}`); }
    }
  }

  assert.deepEqual(app.scriptMisses, [], 'every message the scripted model saw had a script');
  if (!smoke) assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource|ERR_CONNECTION|net::|TypeError: Failed to fetch|network error/i.test(problem)), []);
  if (smoke) {
    const passed = smokeResults.filter(result => result.passed).length, rate = smokeResults.length ? passed / smokeResults.length : 0, minimum = Number(process.env.STUDIO_SMOKE_MIN ?? 0.6);
    console.log(`smoke pass rate: ${passed}/${smokeResults.length} (${Math.round(rate * 100)}%), threshold ${Math.round(minimum * 100)}%`);
    writeFileSync(join(evidence, 'smoke.json'), JSON.stringify({ passed, total: smokeResults.length, rate, minimum, results: smokeResults }, null, 2));
    if (rate < minimum) process.exitCode = 1;
    else process.exitCode = 0;
    for (const result of smokeResults.filter(item => !item.passed)) console.log(`  failed: ${result.id}: ${result.error}`);
  }
  const summary = { provider: app.provider, scripted: app.scripted, variants: app.variants().map(variant => ({ id: variant.id, available: variant.available, ...(variant.tools ? { tools: variant.tools, model: variant.model } : { reason: variant.reason }) })), steps };
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) { await browser.screenshot('last.png').catch(() => {}); await browser.close(); }
  await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 15000))]);
  // After a full run something used by a scenario (not yet identified) can keep the event loop alive, so exit explicitly.
  process.exit(process.exitCode ?? 0);
}
