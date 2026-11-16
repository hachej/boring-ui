import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NotYours, Session, mustOwn } from "@hachej/boring-agent/host";
import { ContactAdded } from "./AddContact.command.ts";
import { Inbox } from "./Inbox.aggregate.ts";

const Contact = Schema.Struct({ name: Schema.String, address: Schema.String });

/** The people the notebook knows by e-mail address: the supervisor asks it, in code, who a message is from. */
export class Contacts extends Domain.View("Contacts", {
  from: [Inbox], key: Inbox, version: 1,
  middleware: [Session], rejects: [NotYours],
  state: Schema.Struct({ contacts: Schema.Array(Contact) }),
  initial: { contacts: [] },
  evolve: { ContactAdded: (v, e: ContactAdded) => ({ contacts: [...v.contacts.filter((c) => c.address !== e.address), { name: e.name, address: e.address }] }) },
}, { description: "The contacts of the notebook: a name and an e-mail address each." }) {}

export const ContactsLive = Contacts.toLayer(Effect.succeed(Effect.fn(function* (request) { yield* mustOwn(request.key as { id: string }); })));
