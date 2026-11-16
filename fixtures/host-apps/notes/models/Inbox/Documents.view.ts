import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotYours, Session, mustOwn } from "@hachej/boring-agent/host";
import { GistRecorded, DocumentDeposited, Topic } from "./Deposit.command.ts";
import { Inbox } from "./Inbox.aggregate.ts";

const Doc = Schema.Struct({ number: Schema.Int, name: Schema.String, topic: Schema.optional(Topic) });

/** The text of a document is not here: what a reader recorded is all the rest of the app (and its assistant) sees of it. */
export class Documents extends Domain.View("Documents", {
  from: [Inbox], key: Inbox, version: 1,
  middleware: [Session], rejects: [NotYours],
  state: Schema.Struct({ documents: Schema.Array(Doc) }),
  initial: { documents: [] },
  evolve: {
    DocumentDeposited: (v, e: DocumentDeposited) => ({ documents: [...v.documents, { number: e.number, name: e.name }] }),
    GistRecorded: (v, e: GistRecorded) => ({ documents: v.documents.map((d) => (d.number === e.number ? { ...d, topic: e.topic } : d)) }),
  },
}, { description: "The deposited documents by number and name, with the topic a reader recorded. Never their text." }) {}

export const DocumentsLive = Documents.toLayer(Effect.succeed(Effect.fn(function* (request) { yield* mustOwn(request.key as { id: string }); })));
