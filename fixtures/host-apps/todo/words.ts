// Every word the host reads in French, the base language. words.de.ts has the same keys.
const words = {
  app: { title: "Tâches" },
  views: { todos: "Tâches" },
  refusals: { NotYours: "Cette liste n'est pas à toi." },
};
export type Words = typeof words;
export default words;
