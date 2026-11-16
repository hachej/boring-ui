import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CurrentUser, mustOwn } from "@hachej/boring-agent/host";
import { AddNote, EmptyNote, NoteAdded } from "./AddNote.command.ts";
import { NotebookId } from "./NotebookId.id.ts";

export class Notebook extends Domain.Aggregate("Notebook", {
  id: NotebookId,
  state: Schema.Struct({ count: Schema.Int }),
  initial: { count: 0 },
  commands: [AddNote],
  decide: {
    AddNote: Effect.fn(function* (s, c, { now, id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      if (c.text.trim() === "") return yield* new EmptyNote({ received: c.text });
      return [new NoteAdded({ number: s.count + 1, text: c.text.trim(), by: me.userId, at: DateTime.formatIso(now) })];
    }),
  },
  evolve: { NoteAdded: (_s, e) => ({ count: e.number }) },
  reply: { AddNote: (s) => ({ number: s.count }) },
}, { description: "One person's notebook: the notes they added, numbered in order." }) {}
