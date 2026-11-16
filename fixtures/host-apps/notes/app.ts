// The notes app: one definition. Everything else in this folder is the models, the agents, a skill folder and a view.
import { defineApp } from "@hachej/boring-agent/host";
import { agents } from "./agents.ts";
import fr from "./words.ts";
import en from "./words.en.ts";
import { Notebook, NotebookHandlers, ReaderOnDeposit } from "./models/Notebook.model.ts";
import { NotebookApi } from "./models/NotebookApi.api.ts";

const reads = ["Notes.get", "Documents.get", "Contacts.get"] as const;

export default defineApp({
  name: "notes", languages: { base: "fr", words: { fr, en } },
  models: [Notebook], handlers: NotebookHandlers, api: NotebookApi,
  expose: {
    page: ["AddNote", "Deposit", "AddContact", ...reads],
    mcp: ["AddNote", "Notes.get", "Documents.get"],
    assistant: ["AddNote", "AddContact", "RecordGist", ...reads],
    researcher: ["Notes.get", "Documents.get"],
    reader: ["RecordGist"],
  },
  views: [{ id: "notes", component: "./web/NotesView.tsx" }],
  agents, skills: "./skills",
  wakes: [{ policy: ReaderOnDeposit, agent: "reader", key: (e: any) => String(e.number), message: (e: any) => `Document n°${e.number} « ${e.name} » :\n${e.body}` }],
  seed: {
    people: [{ name: "Camille Martin", email: "camille.p1@example.test" }, { name: "Dominique Leroy", email: "dominique.p1@example.test" }, { name: "Edgar Faure", email: "edgar.p1@example.test" }],
    operations: [{ as: "camille.p1@example.test", op: "AddNote", input: { text: "Appeler le garage lundi" } }],
  },
  needs: ["files"],
});
