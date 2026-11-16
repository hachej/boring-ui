import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CurrentUser, NotYours, Role, must } from "@hachej/boring-agent/host";
import { AddNote, CreateNotebook, EmptyNote, LastOwner, MemberRemoved, MemberSet, NoteAdded, NotebookCreated, RemoveMember, SetMember } from "./AddNote.command.ts";
import { AlreadyRecorded, Deposit, DocumentDeposited, EmptyDocument, GistRecorded, RecordGist, UnknownDocument } from "./Deposit.command.ts";
import { NotebookId } from "./NotebookId.id.ts";

const Member = Schema.Struct({ userId: Schema.String, role: Role });

/** One aggregate holds the members, the notes, the documents deposited and their gists; every command checks the members' list with `must`, never `mustOwn`. */
export class Notebook extends Domain.Aggregate("Notebook", {
  id: NotebookId,
  state: Schema.Struct({ members: Schema.Array(Member), notes: Schema.Int, docs: Schema.Int, recorded: Schema.Array(Schema.Int) }),
  initial: { members: [], notes: 0, docs: 0, recorded: [] },
  commands: [CreateNotebook, SetMember, RemoveMember, AddNote, Deposit, RecordGist],
  decide: {
    CreateNotebook: Effect.fn(function* (s, c) {
      const me = yield* CurrentUser;
      // An agent session never creates a notebook, and an existing one is not revealed.
      if (s.members.length > 0 || me.scope) return yield* new NotYours();
      if (c.name.trim() === "") return yield* new EmptyNote({ received: c.name });
      return [new NotebookCreated({ name: c.name.trim(), by: me.userId })];
    }),
    SetMember: Effect.fn(function* (s, c, { id }) {
      yield* must("owner", id, s.members, "SetMember");
      return [new MemberSet({ userId: c.userId, role: c.role, by: (yield* CurrentUser).userId })];
    }),
    RemoveMember: Effect.fn(function* (s, c, { id }) {
      yield* must("owner", id, s.members, "RemoveMember");
      const target = s.members.find((m) => m.userId === c.userId);
      if (target?.role === "owner" && s.members.filter((m) => m.role === "owner").length === 1) return yield* new LastOwner();
      return target ? [new MemberRemoved({ userId: c.userId, by: (yield* CurrentUser).userId })] : [];
    }),
    AddNote: Effect.fn(function* (s, c, { id, now }) {
      yield* must("editor", id, s.members, "AddNote");
      if (c.text.trim() === "") return yield* new EmptyNote({ received: c.text });
      return [new NoteAdded({ number: s.notes + 1, text: c.text.trim(), by: (yield* CurrentUser).userId, at: DateTime.formatIso(now) })];
    }),
    Deposit: Effect.fn(function* (s, c, { id, now }) {
      yield* must("editor", id, s.members, "Deposit");
      if (c.name.trim() === "" || c.body.trim() === "") return yield* new EmptyDocument({ received: c.name });
      return [new DocumentDeposited({ number: s.docs + 1, name: c.name.trim(), body: c.body, by: (yield* CurrentUser).userId, at: DateTime.formatIso(now) })];
    }),
    RecordGist: Effect.fn(function* (s, c, { id }) {
      yield* must("editor", id, s.members, "RecordGist");
      if (c.number < 1 || c.number > s.docs) return yield* new UnknownDocument({ number: c.number });
      if (s.recorded.includes(c.number)) return yield* new AlreadyRecorded({ number: c.number });
      return [new GistRecorded({ number: c.number, topic: c.topic, by: (yield* CurrentUser).userId })];
    }),
  },
  evolve: {
    NotebookCreated: (s, e: NotebookCreated) => ({ ...s, members: [{ userId: e.by, role: "owner" as const }] }),
    MemberSet: (s, e: MemberSet) => ({ ...s, members: [...s.members.filter((m) => m.userId !== e.userId), { userId: e.userId, role: e.role }] }),
    MemberRemoved: (s, e: MemberRemoved) => ({ ...s, members: s.members.filter((m) => m.userId !== e.userId) }),
    NoteAdded: (s, e) => ({ ...s, notes: e.number }),
    DocumentDeposited: (s, e) => ({ ...s, docs: e.number }),
    GistRecorded: (s, e) => ({ ...s, recorded: [...s.recorded, e.number] }),
  },
  reply: {
    CreateNotebook: () => ({ created: true }), SetMember: (s) => ({ members: s.members.length }), RemoveMember: (s) => ({ members: s.members.length }),
    AddNote: (s) => ({ number: s.notes }), Deposit: (s) => ({ number: s.docs }), RecordGist: (s) => ({ number: s.recorded[s.recorded.length - 1] ?? 0 }),
  },
}, { description: "A notebook: its members with their roles, its notes, the documents deposited in it and the topic a reader gave each." }) {}
