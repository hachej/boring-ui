// Every word the host reads in French, the base language. words.en.ts has the same keys.
const words = {
  app: { title: "Notes" },
  views: { notes: "Notes" },
  refusals: { NotYours: "Ce carnet n'est pas à toi.", NotAllowed: "Ton rôle ne le permet pas." },
};
export type Words = typeof words;
export default words;
