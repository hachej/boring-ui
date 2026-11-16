import type { Words } from "./words.ts";

export default {
  app: { title: "Tasks" },
  views: { todos: "Tasks" },
  refusals: { NotYours: "This list is not yours." },
} satisfies Words;
