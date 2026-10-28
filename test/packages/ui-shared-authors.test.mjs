import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Who wrote each message, in plain words: the rules of registry/shared-chat/names.ts (names, when authors show, what sits above a run).
// The registry sources import each other without extensions (an app bundler resolves them); Node needs the extension, so the three
// pure files are loaded from a temporary copy whose relative imports name it. The sources are not touched.
const dir = join(import.meta.dirname, '../../registry/shared-chat');
const scratch = mkdtempSync(join(tmpdir(), 'shared-authors-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
for (const file of ['names.ts', 'shared-labels.ts', 'shared-labels-fr.ts']) {
  const text = readFileSync(join(dir, file), 'utf8').replace(/from '(\.\/[\w-]+)'/g, "from '$1.ts'");
  writeFileSync(join(scratch, file), text);
}
const load = file => import(pathToFileURL(join(scratch, file)).href);
const { agentKind, memberName, namedMember, showsAuthors, runHead } = await load('names.ts');
const { defaultSharedLabels } = await load('shared-labels.ts');
const { frenchSharedLabels } = await load('shared-labels-fr.ts');

const me = { id: "user_me", name: "Julien", kind: "person" }
const camille = { id: "user_1f3a9c", name: "Camille", kind: "person" }
const hugo = { id: "user_77b2e0", name: "Hugo", kind: "person" }
const pm = { id: "agent:pm", name: "agent:pm", kind: "agent", role: "agent:pm" }
const builder = { id: "agent:builder", name: "builder-7f3a", kind: "agent", role: "agent:builder" }
const other = { id: "agent:7d1c2e9a", name: "agent:7d1c2e9a", kind: "agent" }

test("names are shown for others when two or more members besides the reader are in the thread", () => {
  assert.equal(showsAuthors([me, camille, hugo], me.id), true)
  assert.equal(showsAuthors([me, camille, pm], me.id), true)
  assert.equal(showsAuthors([me, camille, hugo, pm, builder], me.id), true)
  assert.equal(runHead({ first: true, own: false, authors: true }), "author")
  assert.equal(runHead({ first: false, own: false, authors: true }), undefined, "only the first bubble of a run carries the name")
  assert.equal(runHead({ first: true, own: true, authors: true }), undefined, "my own messages carry no name")
})

test("solo and pair rooms keep their look: no author line", () => {
  assert.equal(showsAuthors([me], me.id), false)
  assert.equal(showsAuthors([me, pm], me.id), false, "only me and the assistant")
  assert.equal(showsAuthors([me, camille], me.id), false)
  assert.equal(showsAuthors([me, camille, hugo], me.id, false), false, "a host that turns presence off")
  assert.equal(runHead({ first: true, own: false, authors: false }), undefined)
})

test("a message of mine posted through an outside agent says so on my side, and only on the first bubble of its run", () => {
  assert.equal(runHead({ first: true, own: true, authors: true, via: "Claude" }), "via")
  assert.equal(runHead({ first: true, own: true, authors: false, via: "Claude" }), "via", "also in a pair or solo room")
  assert.equal(runHead({ first: false, own: true, authors: true, via: "Claude" }), undefined)
  assert.equal(runHead({ first: true, own: false, authors: true, via: "Claude" }), "author", "someone else's via sits beside their name")
  assert.equal(defaultSharedLabels.sharedVia("Claude"), "via Claude")
  assert.equal(frenchSharedLabels.sharedVia("Claude"), "via Claude")
})

test("an id or a slug never stands for a name", () => {
  const uuid = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6f"
  for (const member of [camille, hugo, pm, builder, other, { id: "user_abc123", name: "user_abc123", kind: "person" }, { id: uuid, name: uuid, kind: "person" }]) {
    for (const words of [defaultSharedLabels.sharedName, frenchSharedLabels.sharedName]) {
      const shown = namedMember(member, words).name
      assert.notEqual(shown, member.id)
      assert.doesNotMatch(shown, /agent:|user_|[0-9a-f]{8}-|7d1c2e9a|7f3a/)
    }
  }
  assert.equal(memberName(camille), "Camille")
  assert.equal(memberName(pm), "Your assistant")
  assert.equal(memberName(builder), "Builder")
  assert.equal(memberName(other), "An agent")
  assert.equal(memberName({ id: "user_abc123", name: "user_abc123", kind: "person" }), "A teammate")
  assert.equal(agentKind(pm), "assistant")
  assert.equal(agentKind(builder), "builder")
  assert.equal(agentKind(camille), undefined)
})

test("the words are labels: French reads in French, a host can override them", () => {
  assert.equal(memberName(pm, frenchSharedLabels.sharedName), "Votre assistant")
  assert.equal(memberName(other, frenchSharedLabels.sharedName), "Un agent")
  assert.equal(memberName(pm, who => `<${who}>`), "<assistant>")
  const a = namedMember(pm), b = namedMember(pm)
  assert.equal(a, b, "the same member gives the same object (rows compare authors by identity)")
  assert.notEqual(namedMember(pm, frenchSharedLabels.sharedName), a)
})

test("every place that shows a member goes through the names (no raw id rendered)", () => {
  const read = file => readFileSync(join(dir, file), "utf8")
  const messages = read("messages.tsx"), hook = read("use-shared-chat.tsx")
  assert.doesNotMatch(messages, /\.map\(namedMember\)/, "the labels' words must reach every namedMember call")
  assert.doesNotMatch(messages + hook + read("timeline.tsx"), />\s*\{(?:member|author|message)\.(?:id|author)\}\s*</, "an id is never rendered as text")
  assert.match(hook, /namedMember\(\{ id, name: id, kind: 'person' \}, nameOf\)/, "an unknown mention id reads as a teammate, not as the id")
})

test("the room's own agents (the host names them by id) read by role: the PM as the assistant, the worker as the builder, the verifier as an agent", () => {
  const room = [{ id: "agent:pm", name: "agent:pm", kind: "agent", role: "agent:pm" }, { id: "agent:worker", name: "agent:worker", kind: "agent", role: "agent:worker" }, { id: "agent:verifier", name: "agent:verifier", kind: "agent", role: "agent:verifier" }]
  assert.deepEqual(room.map(agentKind), ["assistant", "builder", "agent"])
  assert.deepEqual(room.map(member => memberName(member)), ["Your assistant", "Builder", "An agent"])
  assert.equal(memberName(room[1], frenchSharedLabels.sharedName), "Builder")
  assert.equal(memberName({ id: "person:dev", name: "user_7c1e92a4", kind: "person", role: "member" }), "A teammate", "a directory entry with an id for a name")
})
