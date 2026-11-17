// The to-do app's one model: a person's list (an aggregate keyed by their user id), two commands, one view.
import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CurrentUser, NotYours, Session, mustOwn } from "@hachej/boring-agent/host";

export const ListId = Schema.String.pipe(Schema.brand("ListId"));
const Item = Schema.Struct({ number: Schema.Int, text: Schema.String, done: Schema.Boolean });

export class TodoAdded extends Domain.Event("TodoAdded", { number: Schema.Int, text: Schema.String, by: Schema.String, at: Schema.String }, { description: "A to-do was added to the list." }) {}
export class TodoCompleted extends Domain.Event("TodoCompleted", { number: Schema.Int, by: Schema.String }, { description: "A to-do was ticked off." }) {}
export class EmptyTodo extends Domain.Rejection("EmptyTodo", { received: Schema.String }, { description: "The text of the to-do is empty." }) {}
export class UnknownTodo extends Domain.Rejection("UnknownTodo", { number: Schema.Int }, { description: "No to-do has this number." }) {}

export class AddTodo extends Domain.Command("AddTodo", { target: ListId, middleware: [Session], input: { text: Schema.String }, events: [TodoAdded], rejects: [EmptyTodo, NotYours], reply: { number: Schema.Int } },
  { description: "Add a to-do to the list. A blank text is refused." }) {}
export class CompleteTodo extends Domain.Command("CompleteTodo", { target: ListId, middleware: [Session], input: { number: Schema.Int }, events: [TodoCompleted], rejects: [UnknownTodo, NotYours], reply: { number: Schema.Int } },
  { description: "Tick a to-do off, by its number." }) {}

export class TodoList extends Domain.Aggregate("TodoList", {
  id: ListId, state: Schema.Struct({ count: Schema.Int, done: Schema.Array(Schema.Int) }), initial: { count: 0, done: [] }, commands: [AddTodo, CompleteTodo],
  decide: {
    AddTodo: Effect.fn(function* (s, c, { now, id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      if (c.text.trim() === "") return yield* new EmptyTodo({ received: c.text });
      return [new TodoAdded({ number: s.count + 1, text: c.text.trim(), by: me.userId, at: DateTime.formatIso(now) })];
    }),
    CompleteTodo: Effect.fn(function* (s, c, { id }) {
      yield* mustOwn(id);
      const me = yield* CurrentUser;
      if (c.number < 1 || c.number > s.count) return yield* new UnknownTodo({ number: c.number });
      return [new TodoCompleted({ number: c.number, by: me.userId })];
    }),
  },
  evolve: { TodoAdded: (s, e) => ({ ...s, count: e.number }), TodoCompleted: (s, e) => ({ ...s, done: [...s.done.filter((n) => n !== e.number), e.number] }) },
  reply: { AddTodo: (s) => ({ number: s.count }), CompleteTodo: (s) => ({ number: s.done[s.done.length - 1] ?? 0 }) },
}, { description: "One person's to-do list, numbered in order." }) {}

export class Todos extends Domain.View("Todos", {
  from: [TodoList], key: TodoList, version: 1, middleware: [Session], rejects: [NotYours],
  state: Schema.Struct({ items: Schema.Array(Item) }), initial: { items: [] },
  evolve: {
    TodoAdded: (v, e: TodoAdded) => ({ items: [...v.items, { number: e.number, text: e.text, done: false }] }),
    TodoCompleted: (v, e: TodoCompleted) => ({ items: v.items.map((i) => (i.number === e.number ? { ...i, done: true } : i)) }),
  },
}, { description: "The to-dos of the list in order, each with whether it is done." }) {}

export const TodosLive = Todos.toLayer(Effect.succeed(Effect.fn(function* (request) { yield* mustOwn(request.key as { id: string }); })));
export class TodoModel extends Domain.Model("TodoModel", { aggregates: [TodoList], views: [Todos] }) {}
export class TodoApi extends Domain.Api("TodoApi", { model: TodoModel, commands: ["AddTodo", "CompleteTodo"], views: ["Todos"], streams: [], queries: [] },
  { description: "Add a to-do, tick a to-do off by its number, and read the list." }) {}
