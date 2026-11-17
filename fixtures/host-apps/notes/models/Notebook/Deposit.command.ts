import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { NotAllowed, NotYours, Session } from "@hachej/boring-agent/host";
import { NotebookId } from "./NotebookId.id.ts";

/** What a reader of documents records about one: a closed list, so nothing the document says can become free text in the app. */
export const Topic = Schema.Literals(["shopping", "work", "personal", "other"]);

export class DocumentDeposited extends Domain.Event("DocumentDeposited", {
  number: Schema.Int, name: Schema.String, body: Schema.String, by: Schema.String, at: Schema.String,
}, { description: "A document from outside was deposited in the notebook." }) {}

export class GistRecorded extends Domain.Event("GistRecorded", {
  number: Schema.Int, topic: Topic, by: Schema.String,
}, { description: "A reader recorded what topic a deposited document is about." }) {}

export class EmptyDocument extends Domain.Rejection("EmptyDocument", { received: Schema.String }, { description: "The document has no name or no text." }) {}
export class UnknownDocument extends Domain.Rejection("UnknownDocument", { number: Schema.Int }, { description: "No document has this number." }) {}
export class AlreadyRecorded extends Domain.Rejection("AlreadyRecorded", { number: Schema.Int }, { description: "This document's topic is already recorded." }) {}

export class Deposit extends Domain.Command("Deposit", {
  target: NotebookId, middleware: [Session],
  input: { name: Schema.String, body: Schema.String },
  events: [DocumentDeposited], rejects: [EmptyDocument, NotYours, NotAllowed],
  reply: { number: Schema.Int },
}, { description: "Deposit a document from outside (a file name and its text) in the notebook." }) {}

export class RecordGist extends Domain.Command("RecordGist", {
  target: NotebookId, middleware: [Session],
  input: { number: Schema.Int, topic: Topic },
  events: [GistRecorded], rejects: [UnknownDocument, AlreadyRecorded, NotYours, NotAllowed],
  reply: { number: Schema.Int },
}, { description: "Record which topic a deposited document is about: one of shopping, work, personal, other. Once per document." }) {}
