import * as Domain from "@alchemy.run/domain";
import { Notebook } from "./Notebook.model.ts";

/** What the owner of a notebook does and sees. */
export class NotebookApi extends Domain.Api("NotebookApi", {
  model: Notebook,
  commands: ["AddNote", "Deposit", "RecordGist", "AddContact"],
  views: ["Notes", "Documents", "Contacts"],
  streams: [],
  queries: [],
}, { description: "Add a note to the notebook, deposit a document from outside, record the topic of a document, add a contact, and read the notes, the documents and the contacts." }) {}
