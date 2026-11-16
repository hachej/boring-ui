import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { NotAllowed, NotYours, Role, Session } from "@hachej/boring-agent/host";
import { NotebookId } from "./NotebookId.id.ts";

const cmd = { target: NotebookId, middleware: [Session] } as const;
const rights = [NotYours, NotAllowed] as const;

export class NotebookCreated extends Domain.Event("NotebookCreated", { name: Schema.String, by: Schema.String }, { description: "A notebook was created; its creator is its first owner." }) {}
export class MemberSet extends Domain.Event("MemberSet", { userId: Schema.String, role: Role, by: Schema.String }, { description: "A person was given a role in the notebook, or their role changed." }) {}
export class MemberRemoved extends Domain.Event("MemberRemoved", { userId: Schema.String, by: Schema.String }, { description: "A person no longer belongs to the notebook." }) {}
export class NoteAdded extends Domain.Event("NoteAdded", {
  number: Schema.Int, text: Schema.String, by: Schema.String, at: Schema.String,
}, { description: "A note was added to the notebook." }) {}

export class EmptyNote extends Domain.Rejection("EmptyNote", { received: Schema.String }, { description: "The text of the note is empty or only spaces." }) {}
export class LastOwner extends Domain.Rejection("LastOwner", {}, { description: "A notebook keeps at least one owner." }) {}

export class CreateNotebook extends Domain.Command("CreateNotebook", {
  ...cmd, input: { name: Schema.String }, events: [NotebookCreated], rejects: [EmptyNote, ...rights], reply: { created: Schema.Boolean },
}, { description: "Create a notebook; you become its owner." }) {}
export class SetMember extends Domain.Command("SetMember", {
  ...cmd, input: { userId: Schema.String, role: Role }, events: [MemberSet], rejects: [...rights], reply: { members: Schema.Int },
}, { description: "Give a person a role in the notebook (owner only)." }) {}
export class RemoveMember extends Domain.Command("RemoveMember", {
  ...cmd, input: { userId: Schema.String }, events: [MemberRemoved], rejects: [LastOwner, ...rights], reply: { members: Schema.Int },
}, { description: "Remove a person from the notebook (owner only); the last owner stays." }) {}
export class AddNote extends Domain.Command("AddNote", {
  ...cmd, input: { text: Schema.String }, events: [NoteAdded], rejects: [EmptyNote, ...rights], reply: { number: Schema.Int },
}, { description: "Add a note to the notebook. A blank text is refused." }) {}
