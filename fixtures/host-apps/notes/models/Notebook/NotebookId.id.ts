import * as Schema from "effect/Schema";

/** A notebook is a unit, the thing people share. Its key is the id of the person who created it (the seed applies each operation to its person's own id); who may use it is its members' list. */
export const NotebookId = Schema.String.pipe(Schema.brand("NotebookId"));
export type NotebookId = typeof NotebookId.Type;
