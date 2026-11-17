import type { Words } from "./words.ts";

export default {
  app: { title: "Notes" },
  views: { notes: "Notes" },
  refusals: { NotYours: "This notebook is not yours.", NotAllowed: "Your role does not allow it.", LastOwner: "A notebook keeps at least one owner." },
  notes: { empty: "No notes." },
} satisfies Words;
