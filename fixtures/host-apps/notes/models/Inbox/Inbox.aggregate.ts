import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CurrentUser, mustOwn } from "@hachej/boring-agent/host";
import { AddContact, ContactAdded, InvalidContact } from "./AddContact.command.ts";
import { AlreadyRecorded, Deposit, DocumentDeposited, EmptyDocument, GistRecorded, RecordGist, UnknownDocument } from "./Deposit.command.ts";
import { InboxId } from "./InboxId.id.ts";

export class Inbox extends Domain.Aggregate("Inbox", {
  id: InboxId,
  state: Schema.Struct({ count: Schema.Int, recorded: Schema.Array(Schema.Int) }),
  initial: { count: 0, recorded: [] },
  commands: [Deposit, RecordGist, AddContact],
  decide: {
    Deposit: Effect.fn(function* (s, c, { now, id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      if (c.name.trim() === "" || c.body.trim() === "") return yield* new EmptyDocument({ received: c.name });
      return [new DocumentDeposited({ number: s.count + 1, name: c.name.trim(), body: c.body, by: me.userId, at: DateTime.formatIso(now) })];
    }),
    AddContact: Effect.fn(function* (_s, c, { id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      const address = c.address.trim().toLowerCase();
      if (c.name.trim() === "" || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address)) return yield* new InvalidContact({ received: c.address });
      return [new ContactAdded({ name: c.name.trim(), address, by: me.userId })];
    }),
    RecordGist: Effect.fn(function* (s, c, { id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      if (c.number < 1 || c.number > s.count) return yield* new UnknownDocument({ number: c.number });
      if (s.recorded.includes(c.number)) return yield* new AlreadyRecorded({ number: c.number });
      return [new GistRecorded({ number: c.number, topic: c.topic, by: me.userId })];
    }),
  },
  evolve: {
    DocumentDeposited: (s, e) => ({ ...s, count: e.number }),
    GistRecorded: (s, e) => ({ ...s, recorded: [...s.recorded, e.number] }),
    ContactAdded: (s, _e: ContactAdded) => s,
  },
  reply: { Deposit: (s) => ({ number: s.count }), RecordGist: (s) => ({ number: s.recorded[s.recorded.length - 1] ?? 0 }), AddContact: () => ({ added: true }) },
}, { description: "The documents deposited from outside, numbered in order, and the topic a reader recorded for each." }) {}
