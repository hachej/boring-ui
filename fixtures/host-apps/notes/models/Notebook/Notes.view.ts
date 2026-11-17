import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotAllowed, NotYours, Role, Session, must } from "@hachej/boring-agent/host";
import { MemberRemoved, MemberSet, NoteAdded, NotebookCreated } from "./AddNote.command.ts";
import { Notebook } from "./Notebook.aggregate.ts";

const Member = Schema.Struct({ userId: Schema.String, role: Role });
const Note = Schema.Struct({ number: Schema.Int, text: Schema.String, by: Schema.String, at: Schema.String });

/** What a member sees: the members with their roles and the notes, each with its author. Who may read it is the members' list in its own state. */
export class Notes extends Domain.View("Notes", {
  from: [Notebook], key: Notebook, version: 1,
  middleware: [Session], rejects: [NotYours, NotAllowed],
  state: Schema.Struct({ name: Schema.String, members: Schema.Array(Member), notes: Schema.Array(Note) }),
  initial: { name: "", members: [], notes: [] },
  evolve: {
    NotebookCreated: (v, e: NotebookCreated) => ({ ...v, name: e.name, members: [{ userId: e.by, role: "owner" as const }] }),
    MemberSet: (v, e: MemberSet) => ({ ...v, members: [...v.members.filter((m) => m.userId !== e.userId), { userId: e.userId, role: e.role }] }),
    MemberRemoved: (v, e: MemberRemoved) => ({ ...v, members: v.members.filter((m) => m.userId !== e.userId) }),
    NoteAdded: (v, e: NoteAdded) => ({ ...v, notes: [{ number: e.number, text: e.text, by: e.by, at: e.at }, ...v.notes] }),
  },
}, { description: "The notebook as a member sees it: its members and roles, and its notes newest first, each with its author." }) {}

export const NotesLive = Notes.toLayer(Effect.succeed(Effect.fn(function* (request, state) {
  if (!state) return yield* new NotYours();
  yield* must("reader", (request.key as { id: string }).id, state.members, "Notes.get");
})));
