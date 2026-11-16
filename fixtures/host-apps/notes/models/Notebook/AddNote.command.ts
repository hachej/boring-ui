import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { NotYours, Session } from "@hachej/boring-agent/host";
import { NotebookId } from "./NotebookId.id.ts";

export class NoteAdded extends Domain.Event("NoteAdded", {
  number: Schema.Int, text: Schema.String, by: Schema.String, at: Schema.String,
}, { description: "A note was added to the notebook." }) {}

export class EmptyNote extends Domain.Rejection("EmptyNote", { received: Schema.String }, { description: "The text of the note is empty or only spaces." }) {}

export class AddNote extends Domain.Command("AddNote", {
  target: NotebookId,
  middleware: [Session],
  input: { text: Schema.String },
  events: [NoteAdded],
  rejects: [EmptyNote, NotYours],
  reply: { number: Schema.Int },
}, { description: "Add a note to the notebook. A blank text is refused." }) {}
