import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { NotYours, Session } from "@hachej/boring-agent/host";
import { InboxId } from "./InboxId.id.ts";

export class ContactAdded extends Domain.Event("ContactAdded", {
  name: Schema.String, address: Schema.String, by: Schema.String,
}, { description: "A person or company the notebook knows by e-mail address was added." }) {}

export class InvalidContact extends Domain.Rejection("InvalidContact", { received: Schema.String }, { description: "The name is empty or the address is not an e-mail address." }) {}

export class AddContact extends Domain.Command("AddContact", {
  target: InboxId, middleware: [Session],
  input: { name: Schema.String, address: Schema.String },
  events: [ContactAdded], rejects: [InvalidContact, NotYours],
  reply: { added: Schema.Boolean },
}, { description: "Add a contact: a name and the e-mail address its messages come from. A message from a contact is read at once, like a member's." }) {}
