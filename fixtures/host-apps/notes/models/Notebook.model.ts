import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";
import { Contacts, ContactsLive } from "./Inbox/Contacts.view.ts";
import { DocumentDeposited } from "./Inbox/Deposit.command.ts";
import { Documents, DocumentsLive } from "./Inbox/Documents.view.ts";
import { Inbox } from "./Inbox/Inbox.aggregate.ts";
import { Notebook as NotebookAggregate } from "./Notebook/Notebook.aggregate.ts";
import { Notes, NotesLive } from "./Notebook/Notes.view.ts";

/** A deposited document is an event a reader may react to; what reacts is named in app.ts (`wakes`). */
export class ReaderOnDeposit extends Domain.Policy("ReaderOnDeposit", { from: Inbox, on: [DocumentDeposited] }) {}

export class Notebook extends Domain.Model("Notebook", { aggregates: [NotebookAggregate, Inbox], views: [Notes, Documents, Contacts], policies: [ReaderOnDeposit] }) {}

export const NotebookHandlers = Layer.mergeAll(NotesLive, DocumentsLive, ContactsLive);
