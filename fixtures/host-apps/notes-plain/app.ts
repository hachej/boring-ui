// The notes app as plain operations: one definition, no Domain. Words, view and skills are the `notes` fixture's.
import { defineApp } from "@hachej/boring-agent/host";
import { agents } from "./agents.ts";
import { expose, list, members, schema } from "./ops.ts";
import fr from "../notes/words.ts";
import en from "../notes/words.en.ts";

export default defineApp({
  name: "notes-plain", languages: { base: "fr", words: { fr, en } },
  ops: { list, members, schema },
  expose,
  views: [{ id: "notes", component: "../notes/web/NotesView.tsx" }],
  agents, skills: "../notes/skills",
  units: { view: "listNotes", members: (state: any) => state.members },
});
