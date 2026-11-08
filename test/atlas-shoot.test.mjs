import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { decodePng, pngChanged } from '../packages/ui/bin/boring-ui-blocks.mjs';

// D-1831 slice 2: `atlas <dir> --url --out` shoots every state of a manifest in a real Chromium. The real bin is spawned against a fictional static
// app served over http (a tiny router, a form, a file input); the PNGs and index.json it writes are what is asserted. In CI a missing browser fails
// the test; it never skips.
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const skip = !process.env.CHROMIUM && !process.env.CI;

let work, server, base;
before(async () => {
  if (skip) return;
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  work = mkdtempSync(join(tmpdir(), 'atlas-shoot-'));
  cpSync(join(root, 'test/fixtures/atlas/app'), join(work, 'app'), { recursive: true });
  server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = path.startsWith('/pages/') && !path.includes('..') ? join(work, 'app', path) : join(work, 'app/index.html');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(readFileSync(existsSync(file) ? file : join(work, 'app/index.html')));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(done => server ? server.close(done) : done());
  if (work) rmSync(work, { recursive: true, force: true });
});

const app = () => join(work, 'app');
const fixtures = () => join(work, 'app/fixtures');
function shoot(dir, out, ...extra) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, 'atlas', dir, '--url', base, '--out', out, '--fixtures', fixtures(), '--commit', 'abc1234', ...extra], { cwd: root });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
const index = out => JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const shotsOf = (idx, id) => idx.states.find(s => s.id === id).shots;

let first;
const firstRun = () => first ??= (async () => {
  const out = join(work, 'out1');
  return { out, run: await shoot(app(), out) };
})();

test('shoots every state at 390 touch and 1280, light and dark, and writes index.json', { skip, timeout: 240000 }, async () => {
  const { out, run } = await firstRun();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const idx = index(out);
  assert.equal(idx.version, 1);
  assert.equal(idx.commit, 'abc1234');
  assert.equal(idx.url, base);
  assert.ok(!Number.isNaN(Date.parse(idx.createdAt)));
  assert.deepEqual(idx.states.map(s => s.id), ['connexion.form', 'connexion.merci', 'ecritures.import']);
  const merci = idx.states[1];
  assert.deepEqual([merci.page, merci.title, merci.flow, merci.after], ['/connexion', 'Connexion, merci', 'connexion', 'Envoyer']);
  assert.equal('flow' in idx.states[2] || 'after' in idx.states[2], false);
  let pngs = 0;
  for (const state of idx.states) {
    assert.deepEqual(state.shots.map(s => `${s.viewport}.${s.mode}`), ['390.light', '390.dark', '1280.light', '1280.dark']);
    for (const shot of state.shots) {
      assert.equal(shot.file, `${state.id}.${shot.viewport}.${shot.mode}.png`);
      const file = join(out, shot.file);
      assert.equal(shot.sha256, sha(file));
      assert.deepEqual(shot.consoleErrors, []);
      assert.equal(shot.status, 'new');
      const png = decodePng(readFileSync(file));
      assert.equal(png.width, shot.viewport, `${shot.file} is as wide as its viewport`);
      pngs++;
    }
  }
  assert.equal(pngs, 12);
  // Dark is a different picture from light, and the steps ran: the form state is not the thank-you state.
  const [light, dark] = [shotsOf(idx, 'connexion.form')[2], shotsOf(idx, 'connexion.form')[3]];
  assert.notEqual(light.sha256, dark.sha256);
  assert.notEqual(shotsOf(idx, 'connexion.form')[0].sha256, shotsOf(idx, 'connexion.merci')[0].sha256);
  assert.notEqual(shotsOf(idx, 'ecritures.import')[2].sha256, sha(join(out, 'connexion.form.1280.light.png')));
});

test('a failing step exits 1 and names the state, the step number and the step text', { skip, timeout: 240000 }, async () => {
  const dir = join(work, 'failing');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'atlas.json'), JSON.stringify({ states: [
    { id: 'connexion.broken', page: '/connexion', title: 'Cassé', given: { fixture: 'ledger.synthetic.csv', steps: ['fill Courriel a@example.test', 'click Valider'] } },
    { id: 'apropos.page', page: '/apropos', title: 'À propos', given: { fixture: 'ledger.synthetic.csv' } },
  ] }));
  const { status, stderr } = await shoot(dir, join(work, 'out-failing'));
  assert.equal(status, 1);
  assert.match(stderr, /state connexion\.broken step 2 "click Valider": no element named "Valider"/);
  const idx = index(join(work, 'out-failing'));
  assert.deepEqual(shotsOf(idx, 'connexion.broken'), []);
  assert.equal(shotsOf(idx, 'apropos.page').length, 4, 'the other states are still shot');
});

test('--since marks only the changed state changed, the others same, and a new state new', { skip, timeout: 240000 }, async () => {
  const { out } = await firstRun();
  writeFileSync(join(app(), 'pages/ecritures.html'), `${readFileSync(join(app(), 'pages/ecritures.html'), 'utf8')}<div style="height:200px;background:#c00"></div>\n`);
  const manifest = JSON.parse(readFileSync(join(app(), 'atlas.json'), 'utf8'));
  manifest.states.push({ id: 'apropos.page', page: '/apropos', title: 'À propos', given: { fixture: 'ledger.synthetic.csv' } });
  const dir = join(work, 'second');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'atlas.json'), JSON.stringify(manifest));
  const out2 = join(work, 'out2');
  const run = await shoot(dir, out2, '--since', join(out, 'index.json'));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const idx = index(out2);
  const statuses = id => shotsOf(idx, id).map(s => s.status);
  assert.deepEqual(statuses('ecritures.import'), ['changed', 'changed', 'changed', 'changed']);
  assert.deepEqual(statuses('connexion.form'), ['same', 'same', 'same', 'same']);
  assert.deepEqual(statuses('connexion.merci'), ['same', 'same', 'same', 'same']);
  assert.deepEqual(statuses('apropos.page'), ['new', 'new', 'new', 'new']);
});

const state = (id, page, steps) => ({ id, page, title: id, given: { fixture: 'ledger.synthetic.csv', ...(steps ? { steps } : {}) } });
function manifestDir(name, states) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'atlas.json'), JSON.stringify({ states }));
  return dir;
}

test('every shot gets a fresh browser context: storage and cookies never leak into the next state or mode', { skip, timeout: 240000 }, async () => {
  const out = join(work, 'out-storage');
  const run = await shoot(manifestDir('storage', [state('stockage.a', '/storage'), state('stockage.b', '/storage')]), out);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const idx = index(out);
  for (const id of ['stockage.a', 'stockage.b']) {
    assert.equal(shotsOf(idx, id).length, 4);
    for (const shot of shotsOf(idx, id)) assert.deepEqual(shot.consoleErrors, [], `${id} ${shot.viewport} ${shot.mode} saw storage from an earlier shot`);
  }
});

test('a click goes to the element whose one accessible name is the label, not to a button whose aria-label hides it', { skip, timeout: 240000 }, async () => {
  const out = join(work, 'out-labels');
  const run = await shoot(manifestDir('labels', [state('libelles.save', '/labels', ['click Save', 'wait Saved'])]), out);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const shot of shotsOf(index(out), 'libelles.save')) assert.deepEqual(shot.consoleErrors, [], 'the Delete button was not clicked');
});

test('a disabled target fails the step: exit 1, never a silent click', { skip, timeout: 240000 }, async () => {
  const { status, stderr } = await shoot(manifestDir('disabled', [state('desactive.valider', '/disabled', ['click Valider'])]), join(work, 'out-disabled'));
  assert.equal(status, 1);
  assert.match(stderr, /state desactive\.valider step 1 "click Valider": element named "Valider" is disabled/);
});

test('a click on text inside an actionable ancestor goes by the ancestor name: a span in aria-label Delete is not "Save"', { skip, timeout: 240000 }, async () => {
  const { status, stderr } = await shoot(manifestDir('nested', [state('imbrique.save', '/nested', ['click Save'])]), join(work, 'out-nested'));
  assert.equal(status, 1);
  assert.match(stderr, /state imbrique\.save step 1 "click Save": no element named "Save"/);
});

test('a disabled or aria-disabled ancestor makes the click fail', { skip, timeout: 240000 }, async () => {
  for (const label of ['Valider', 'Envoyer']) {
    const { status, stderr } = await shoot(manifestDir('disabled-nested', [state('ancetre.desactive', '/disabled-nested', [`click ${label}`])]), join(work, 'out-disabled-nested'));
    assert.equal(status, 1, stderr);
    assert.match(stderr, new RegExp(`step 1 "click ${label}": element named "${label}" is disabled`));
  }
});

test('a control in the first legend of a disabled fieldset stays enabled', { skip, timeout: 240000 }, async () => {
  const run = await shoot(manifestDir('legend', [state('legende.enable', '/legend', ['click Enable', 'wait Enabled'])]), join(work, 'out-legend'));
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('Ctrl-C twice during startup still removes the profile, kills Chromium and exits 130', { skip, timeout: 120000 }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'atlas-sig-'));
  try {
    const child = spawn(process.execPath, [bin, 'atlas', app(), '--url', base, '--out', join(work, 'out-sig'), '--fixtures', fixtures(), '--commit', 'abc1234'], { cwd: root, env: { ...process.env, TMPDIR: tmp } });
    const closed = new Promise(resolve => child.on('close', (status, signal) => resolve({ status, signal })));
    for (let i = 0; i < 400 && !readdirSync(tmp).some(f => f.startsWith('atlas-chromium-')); i++) await new Promise(done => setTimeout(done, 25));
    assert.ok(readdirSync(tmp).some(f => f.startsWith('atlas-chromium-')), 'the profile exists once the browser is launching');
    child.kill('SIGINT');
    await new Promise(done => setTimeout(done, 30));
    child.kill('SIGINT');
    const { status, signal } = await closed;
    assert.deepEqual({ status, signal }, { status: 130, signal: null });
    assert.deepEqual(readdirSync(tmp).filter(f => f.startsWith('atlas-chromium-')), [], 'the profile is removed');
    assert.notEqual(spawnSync('pgrep', ['-f', tmp]).status, 0, 'no Chromium of the run is left');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('a page stuck in a loop fails its state within the deadline and leaves no Chromium behind', { skip, timeout: 240000 }, async () => {
  const started = Date.now();
  const { status, stderr } = await shoot(manifestDir('hang', [state('bloquee.page', '/hang', ['wait Bloquée']), state('apropos.after', '/apropos')]), join(work, 'out-hang'));
  assert.equal(status, 1, stderr);
  assert.ok(Date.now() - started < 120000, 'the run ended by its deadline');
  assert.match(stderr, /state bloquee\.page/);
  // The stuck page either stops the probe ("did not answer"), the load ("did not finish loading") or the step's own wait ("did not appear within"): which deadline fires first is a race, and each is a failure by deadline.
  assert.match(stderr, /did not (answer|finish loading|appear) within/);
  let left = true;
  for (let i = 0; i < 30 && left; i++) {
    left = spawnSync('pgrep', ['-f', 'atlas-chromium-']).status === 0;
    if (left) await new Promise(done => setTimeout(done, 200));
  }
  assert.equal(left, false, 'no Chromium process of the run is left');
});

test('without a browser, the command is a use error, not a fake shot', () => {
  const child = spawn(process.execPath, [bin, 'atlas', join(root, 'test/fixtures/atlas/app'), '--url', 'http://127.0.0.1:9', '--out', join(tmpdir(), 'atlas-no-browser')], { cwd: root, env: { ...process.env, CHROMIUM: '' } });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  return new Promise(resolve => child.on('close', status => {
    assert.equal(status, 2);
    assert.match(stderr, /--chromium/);
    resolve();
  }));
});

test('pngChanged: identical is same, a few pixels are noise, a block or another size is changed', () => {
  const png = (w, h, paint) => {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(paint(x, y), y * (w * 4 + 1) + 1 + x * 4);
    return encode(w, h, raw);
  };
  const white = () => [255, 255, 255, 255];
  assert.equal(pngChanged(png(100, 100, white), png(100, 100, white)), false);
  assert.equal(pngChanged(png(100, 100, white), png(100, 100, (x, y) => (x < 5 && y < 1 ? [0, 0, 0, 255] : white()))), false, '5 of 10000 pixels is under 0.1%');
  assert.equal(pngChanged(png(100, 100, white), png(100, 100, (x, y) => (y < 1 ? [0, 0, 0, 255] : white()))), true, '100 of 10000 pixels is over 0.1%');
  assert.equal(pngChanged(png(100, 100, white), png(100, 100, () => [250, 255, 255, 255])), false, 'a difference of 8 or less is not a difference');
  assert.equal(pngChanged(png(100, 100, white), png(100, 101, white)), true);
});

// A minimal RGBA PNG writer for the decoder test (filter 0 rows).
function encode(width, height, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
