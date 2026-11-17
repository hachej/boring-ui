// The notes app written as plain operations over one unit's own SQLite: no Domain, no effect.
import { arr, bool, int, nullable, obj, oneOf, str } from "@earendil-works/pi-schema";
import { defineOp, refuse } from "@hachej/boring-agent/host";
import type { Member, UnitStorage } from "@hachej/boring-agent/host";

const role = oneOf(["owner", "editor", "reader"]);
const topic = oneOf(["shopping", "work", "personal", "other"]);
const owners = async (s: UnitStorage) => (await s.all<{ n: number }>("select count(*) as n from members where role = 'owner'"))[0]!.n;

export const schema = [
  "create table if not exists notebook (name text not null)",
  "create table if not exists members (user_id text primary key, role text not null)",
  "create table if not exists notes (number integer primary key, text text not null, by text not null, at text not null)",
  "create table if not exists documents (number integer primary key, name text not null, body text not null, by text not null, at text not null, topic text)",
];
export const members = async (s: UnitStorage): Promise<readonly Member[]> => (await s.all<{ userId: string; role: string }>("select user_id as userId, role from members")) as readonly Member[];

export const createNotebook = defineOp({
  name: "createNotebook", description: "Create the person's notebook with a name.",
  input: obj({ name: str() }), output: obj({ name: str() }),
  role: "owner", kind: "write",
  run: async ({ name }, ctx) => {
    if ((await members(ctx.storage)).length > 0) return refuse("NotYours");
    if (name.trim() === "") return refuse("EmptyNote", { received: name });
    await ctx.storage.run("insert into notebook (name) values (?)", name.trim());
    await ctx.storage.run("insert into members (user_id, role) values (?, 'owner')", ctx.who.person);
    return { name: name.trim() };
  },
});

export const setMember = defineOp({
  name: "setMember", description: "Give a person a role in the notebook (owner, editor or reader).",
  input: obj({ userId: str(), role }), output: obj({ userId: str(), role }),
  role: "owner", kind: "write",
  run: async (input, ctx) => {
    const [current] = await ctx.storage.all<{ role: string }>("select role from members where user_id = ?", input.userId);
    if (current?.role === "owner" && input.role !== "owner" && (await owners(ctx.storage)) === 1) return refuse("LastOwner");
    await ctx.storage.run("insert into members (user_id, role) values (?, ?) on conflict (user_id) do update set role = excluded.role", input.userId, input.role);
    return input;
  },
});

export const removeMember = defineOp({
  name: "removeMember", description: "Remove a person from the notebook.",
  input: obj({ userId: str() }), output: obj({ removed: bool() }),
  role: "owner", kind: "write", risky: true,
  run: async ({ userId }, ctx) => {
    const [target] = await ctx.storage.all<{ role: string }>("select role from members where user_id = ?", userId);
    if (target?.role === "owner" && (await owners(ctx.storage)) === 1) return refuse("LastOwner");
    await ctx.storage.run("delete from members where user_id = ?", userId);
    return { removed: target !== undefined };
  },
});

export const addNote = defineOp({
  name: "addNote", description: "Add a note to the notebook. A blank text is refused.",
  input: obj({ text: str() }), output: obj({ number: int() }),
  role: "editor", kind: "write",
  run: async ({ text }, ctx) => {
    if (text.trim() === "") return refuse("EmptyNote", { received: text });
    const [{ number }] = await ctx.storage.all<{ number: number }>("insert into notes (number, text, by, at) select coalesce(max(number), 0) + 1, ?, ?, ? from notes returning number", text.trim(), ctx.who.person, ctx.now) as [{ number: number }];
    return { number };
  },
});

export const listNotes = defineOp({
  name: "listNotes", description: "Read the notebook: its name, its members and its notes.",
  input: obj({}),
  output: obj({ name: str(), members: arr(obj({ userId: str(), role })), notes: arr(obj({ number: int(), text: str(), by: str(), at: str() })) }),
  role: "reader", kind: "read",
  run: async (_input, ctx) => ({
    name: (await ctx.storage.all<{ name: string }>("select name from notebook"))[0]?.name ?? "",
    members: await members(ctx.storage) as { userId: string; role: "owner" | "editor" | "reader" }[],
    notes: await ctx.storage.all<{ number: number; text: string; by: string; at: string }>("select number, text, by, at from notes order by number"),
  }),
});

export const deposit = defineOp({
  name: "deposit", description: "Deposit a document (a name and its text) in the notebook.",
  input: obj({ name: str(), body: str() }), output: obj({ number: int() }),
  role: "editor", kind: "write",
  run: async ({ name, body }, ctx) => {
    if (name.trim() === "" || body.trim() === "") return refuse("EmptyDocument", { received: name });
    const [{ number }] = await ctx.storage.all<{ number: number }>("insert into documents (number, name, body, by, at) select coalesce(max(number), 0) + 1, ?, ?, ?, ? from documents returning number", name.trim(), body, ctx.who.person, ctx.now) as [{ number: number }];
    return { number };
  },
});

export const listDocuments = defineOp({
  name: "listDocuments", description: "Read the documents deposited in the notebook.",
  input: obj({}),
  output: obj({ documents: arr(obj({ number: int(), name: str(), body: str(), by: str(), at: str(), topic: nullable(str()) })) }),
  role: "reader", kind: "read",
  run: async (_input, ctx) => ({ documents: await ctx.storage.all<{ number: number; name: string; body: string; by: string; at: string; topic: string | null }>("select number, name, body, by, at, topic from documents order by number") }),
});

export const recordGist = defineOp({
  name: "recordGist", description: "Record the topic of a deposited document, once.",
  input: obj({ number: int(), topic }), output: obj({ number: int(), topic }),
  role: "editor", kind: "write",
  run: async ({ number, topic: value }, ctx) => {
    const [doc] = await ctx.storage.all<{ topic: string | null }>("select topic from documents where number = ?", number);
    if (!doc) return refuse("UnknownDocument", { number });
    if (doc.topic !== null) return refuse("AlreadyRecorded", { number });
    await ctx.storage.run("update documents set topic = ? where number = ?", value, number);
    return { number, topic: value };
  },
});

export const list = [createNotebook, setMember, removeMember, addNote, listNotes, deposit, listDocuments, recordGist];
export const expose = {
  page: ["createNotebook", "setMember", "removeMember", "addNote", "deposit", "listNotes", "listDocuments"],
  mcp: ["addNote", "listNotes", "listDocuments"],
  assistant: ["addNote", "recordGist", "setMember", "removeMember", "listNotes", "listDocuments"],
  researcher: ["listNotes", "listDocuments"],
  reader: ["recordGist"],
};
