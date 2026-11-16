import * as Domain from "@alchemy.run/domain";
import { Notebook } from "./Notebook.model.ts";

/** What a member of a notebook does and sees; each caller has only its own rights (a person's role, or an agent session's scope). */
export class NotebookApi extends Domain.Api("NotebookApi", {
  model: Notebook,
  commands: ["CreateNotebook", "SetMember", "RemoveMember", "AddNote", "Deposit", "RecordGist", "AddContact"],
  views: ["Notes", "Documents", "Contacts"],
  streams: [],
  queries: [],
}, { description: "Create a notebook, give a person a role in it or remove them, add a note, deposit a document, record the topic of a document, add a contact, and read the notes, the documents and the contacts." }) {}
