import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CurrentUser, mustOwn } from "@hachej/boring-agent/host";
import { AddContact, ContactAdded, InvalidContact } from "./AddContact.command.ts";
import { InboxId } from "./InboxId.id.ts";

/** A person's own contacts: personal, keyed by the person's id, checked with `mustOwn`. */
export class Inbox extends Domain.Aggregate("Inbox", {
  id: InboxId,
  state: Schema.Struct({ count: Schema.Int }),
  initial: { count: 0 },
  commands: [AddContact],
  decide: {
    AddContact: Effect.fn(function* (_s, c, { id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      const address = c.address.trim().toLowerCase();
      if (c.name.trim() === "" || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address)) return yield* new InvalidContact({ received: c.address });
      return [new ContactAdded({ name: c.name.trim(), address, by: me.userId })];
    }),
  },
  evolve: { ContactAdded: (s, _e: ContactAdded) => ({ count: s.count + 1 }) },
  reply: { AddContact: () => ({ added: true }) },
}, { description: "One person's contacts: a name and an e-mail address each." }) {}
