import * as Schema from "effect/Schema";

/** A notebook is keyed by its owner's user id: one Durable Object per person's notebook. */
export const NotebookId = Schema.String.pipe(Schema.brand("NotebookId"));
export type NotebookId = typeof NotebookId.Type;
