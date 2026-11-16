// Probe worker (wrangler dev --local, workerd): pi's storage and boring-files' SQLite file system on one Durable Object's SQLite.
// Public exports only: @earendil-works/pi-durable (+ /storage/sqlite/cloudflare), @earendil-works/chord/context, @hachej/boring-files/*, @hachej/boring-testing/model.
import { DurableObject } from 'cloudflare:workers';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { DurableObjectSqliteDatabase, openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { durableObjectSqliteConnection } from '@hachej/boring-files/sqlite-durable-object';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const FILES = [['/workspace/a.txt', 'premier fichier: é à ü 🙂'], ['/workspace/dir/b.txt', 'second fichier, plus long. '.repeat(40)]];
const err = e => String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ');
const delay = ms => new Promise(r => setTimeout(r, ms));

/** The workspace's rows over one object's storage, the way boring-files ships it today (`durableObjectSqliteConnection`: direct `sql.exec`, `transactionSync`). */
const openFiles = storage => openSqliteFileSystem({ connection: durableObjectSqliteConnection(storage), workspace: 'probe', cwd: '/workspace' });

async function writeFiles(fs) {
  const out = [];
  for (const [path, text] of FILES) { const r = await fs.writeFile(path, text, context); out.push({ path, ok: r.ok === true, error: r.ok ? undefined : String(r.error?.message ?? r.error) }); }
  return out;
}
async function readFiles(fs) {
  const out = [];
  for (const [path, text] of FILES) {
    const r = await fs.readTextFile(path, context);
    out.push({ path, present: r.ok === true, sameBytes: r.ok === true && r.value === text, error: r.ok ? undefined : String(r.error?.message ?? r.error) });
  }
  return out;
}

/** The second object of candidate (b): the person's files, alone in their own database. */
export class FilesBox extends DurableObject {
  fs = openFiles(this.ctx.storage);
  writeFiles() { return writeFiles(this.fs); }
  readFiles() { return readFiles(this.fs); }
}

export class Probe extends DurableObject {
  #fs;
  files(mode) { return mode === 'direct' ? (this.#fs ??= openFiles(this.ctx.storage)) : undefined; }
  box() { return this.env.FILES.getByName(this.ctx.id.toString()); }

  /** Before: a Harness commits one conversation with two entries on pi's storage; the probe table exists. */
  async setup() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS probe_rows (id INTEGER PRIMARY KEY, note TEXT)');
    const storage = await openDurableObjectSqliteStorage(this.ctx.storage);
    const fake = createFakeChatModel();
    const harness = await Harness.open(storage, { registry: createRegistry(), models: fake.models }, context);
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
    for (const n of [1, 2]) await conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: `note ${n}`, timestamp: 0 }] } }, context);
    return this.observePi();
  }

  async observePi() {
    const storage = await openDurableObjectSqliteStorage(this.ctx.storage);
    const convs = await storage.scanConversations({}, 10, undefined, context);
    const list = convs.items ?? convs.entries ?? [];
    const out = { conversations: list.length };
    if (list[0]) {
      const page = await storage.scanEntries({ conversationId: list[0].id, order: 'descending' }, 100, undefined, context);
      const items = page.items ?? page.entries ?? [];
      out.entries = items.length; out.lastId = items[0] ? String(items[0].id) : null;
    }
    return out;
  }

  async observe(mode) {
    const out = { pi: await this.observePi() };
    try { out.files = await (mode === 'direct' ? readFiles(this.files(mode)) : this.box().readFiles()); } catch (e) { out.files = `error: ${err(e)}`; }
    out.probeRows = this.ctx.storage.sql.exec('SELECT count(*) AS n FROM probe_rows').one().n;
    return out;
  }

  writeFiles(mode) { return mode === 'direct' ? writeFiles(this.files(mode)) : this.box().writeFiles(); }

  /** pi's transaction: writes one probe row, awaits 200 ms, rejects. Same `ctx.storage` as pi's storage: one queue. `inside` also writes the files from the callback. */
  async rollbackTx(mode, place) {
    const db = new DurableObjectSqliteDatabase(this.ctx.storage);
    const t0 = Date.now(); let inside;
    // `inflight`: a fiber of this object that was already running (a tool finishing after a model call) writes the files while the transaction awaits
    const fiber = place === 'inflight' ? delay(100).then(() => this.writeFiles(mode)).then(r => r, e => `error: ${err(e)}`) : undefined;
    try {
      await db.transaction(async tx => {
        await tx.run("INSERT INTO probe_rows (note) VALUES ('written inside pi transaction')");
        if (place === 'inside') inside = await this.writeFiles(mode).then(r => r, e => `error: ${err(e)}`);
        await delay(200);
        throw new Error('rollback on purpose');
      });
      return { rejected: false, ms: Date.now() - t0 };
    } catch (e) { return { rejected: String(e?.message), ms: Date.now() - t0, inside: fiber ? await fiber : inside }; }
  }

  abort() { this.ctx.abort('probe restart'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') return Response.json({ ok: true });
    const mode = url.searchParams.get('mode') ?? 'direct', place = url.searchParams.get('place') ?? 'request';
    const id = env.PROBE.newUniqueId(); let stub = env.PROBE.get(id);
    const result = { mode, place };
    try {
      result.before = await stub.setup(); result.beforeObserve = await stub.observe(mode);
      if (place !== 'request') result.tx = await stub.rollbackTx(mode, place);
      else {
        const tx = stub.rollbackTx(mode, place);
        await delay(60);
        const started = Date.now();
        // candidate (b): the request goes to the files object itself, not through the object that holds pi's transaction
        const w = (mode === 'direct' ? stub.writeFiles(mode) : env.FILES.getByName(id.toString()).writeFiles()).then(r => ({ ok: true, files: r, waitedMs: Date.now() - started }), e => ({ ok: false, error: err(e), waitedMs: Date.now() - started }));
        [result.tx, result.concurrentWrite] = await Promise.all([tx, w]);
      }
      result.afterRollback = await stub.observe(mode);
      try { await stub.abort(); } catch (e) { result.abortThrew = err(e).slice(0, 120); }
      stub = env.PROBE.get(id);
      result.afterRestart = await stub.observe(mode);
    } catch (e) { result.error = err(e); }
    return Response.json(result);
  },
};
