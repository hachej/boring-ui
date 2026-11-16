import type { Words } from "./words.ts";

export default {
  app: { title: "Aufgaben" },
  views: { todos: "Aufgaben" },
  refusals: { NotYours: "Diese Liste gehört dir nicht." },
} satisfies Words;
