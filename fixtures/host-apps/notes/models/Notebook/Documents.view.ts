import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotAllowed, NotYours, Role, Session, must } from "@hachej/boring-agent/host";
import { MemberRemoved, MemberSet, NotebookCreated } from "./AddNote.command.ts";
import { GistRecorded, DocumentDeposited, Topic } from "./Deposit.command.ts";
import { Notebook } from "./Notebook.aggregate.ts";

const Member = Schema.Struct({ userId: Schema.String, role: Role });
const Doc = Schema.Struct({ number: Schema.Int, name: Schema.String, topic: Schema.optional(Topic) });

/** The text of a document is not here: what a reader recorded is all the rest of the app (and its assistant) sees of it. */
export class Documents extends Domain.View("Documents", {
  from: [Notebook], key: Notebook, version: 1,
  middleware: [Session], rejects: [NotYours, NotAllowed],
  state: Schema.Struct({ members: Schema.Array(Member), documents: Schema.Array(Doc) }),
  initial: { members: [], documents: [] },
  evolve: {
    NotebookCreated: (v, e: NotebookCreated) => ({ ...v, members: [{ userId: e.by, role: "owner" as const }] }),
    MemberSet: (v, e: MemberSet) => ({ ...v, members: [...v.members.filter((m) => m.userId !== e.userId), { userId: e.userId, role: e.role }] }),
    MemberRemoved: (v, e: MemberRemoved) => ({ ...v, members: v.members.filter((m) => m.userId !== e.userId) }),
    DocumentDeposited: (v, e: DocumentDeposited) => ({ ...v, documents: [...v.documents, { number: e.number, name: e.name }] }),
    GistRecorded: (v, e: GistRecorded) => ({ ...v, documents: v.documents.map((d) => (d.number === e.number ? { ...d, topic: e.topic } : d)) }),
  },
}, { description: "The deposited documents by number and name, with the topic a reader recorded. Never their text." }) {}

export const DocumentsLive = Documents.toLayer(Effect.succeed(Effect.fn(function* (request, state) {
  if (!state) return yield* new NotYours();
  yield* must("reader", (request.key as { id: string }).id, state.members, "Documents.get");
})));
