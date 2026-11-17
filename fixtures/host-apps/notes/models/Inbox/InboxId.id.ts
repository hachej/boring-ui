import * as Schema from "effect/Schema";

/** A notebook's inbox is keyed by its owner's user id, like the notebook. */
export const InboxId = Schema.String.pipe(Schema.brand("InboxId"));
export type InboxId = typeof InboxId.Type;
