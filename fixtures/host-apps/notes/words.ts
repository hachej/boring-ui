// Every word the host reads in French, the base language. words.en.ts has the same keys.
// `notes` is the app's own key beyond the host's three (app, views, refusals): the typed-words proof of AppHostProps needs one.
const words = {
  app: { title: "Notes" },
  views: { notes: "Notes" },
  refusals: { NotYours: "Ce carnet n'est pas à toi.", NotAllowed: "Ton rôle ne le permet pas.", LastOwner: "Un carnet garde au moins un propriétaire." },
  notes: { empty: "Aucune note." },
};
export type Words = typeof words;
export default words;
