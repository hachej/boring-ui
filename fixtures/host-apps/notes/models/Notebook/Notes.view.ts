import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotYours, Session, mustOwn } from "@hachej/boring-agent/host";
import { NoteAdded } from "./AddNote.command.ts";
import { Notebook } from "./Notebook.aggregate.ts";

const Note = Schema.Struct({ number: Schema.Int, text: Schema.String, at: Schema.String });

/** The whole list is the view's state: fine for an example, a growing list belongs in a projection with a paged query. */
export class Notes extends Domain.View("Notes", {
  from: [Notebook], key: Notebook, version: 1,
  middleware: [Session], rejects: [NotYours],
  state: Schema.Struct({ notes: Schema.Array(Note) }),
  initial: { notes: [] },
  evolve: { NoteAdded: (v, e: NoteAdded) => ({ notes: [{ number: e.number, text: e.text, at: e.at }, ...v.notes] }) },
}, { description: "The notes of the notebook, newest first." }) {}

export const NotesLive = Notes.toLayer(Effect.succeed(Effect.fn(function* (request) { yield* mustOwn(request.key as { id: string }); })));
