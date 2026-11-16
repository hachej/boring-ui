// A second, different app: a to-do list. One model, two operations, one view, one assistant skill. No files, no reader, no sub-agent.
import { defineApp } from "@hachej/boring-agent/host";
import { agents } from "./agents.ts";
import fr from "./words.ts";
import de from "./words.de.ts";
import { TodoApi, TodoModel, TodosLive } from "./models/Todos.model.ts";

export default defineApp({
  name: "todo", languages: { base: "fr", words: { fr, de }, region: "CH" },
  models: [TodoModel], handlers: TodosLive, api: TodoApi,
  expose: { page: ["AddTodo", "CompleteTodo", "Todos.get"], mcp: ["Todos.get"], assistant: ["AddTodo", "CompleteTodo", "Todos.get"] },
  views: [{ id: "todos", component: "./web/TodosView.tsx" }],
  agents, skills: "./skills",
  seed: {
    people: [{ name: "Camille Martin", email: "camille.p1@example.test" }, { name: "Dominique Leroy", email: "dominique.p1@example.test" }, { name: "Edgar Faure", email: "edgar.p1@example.test" }],
    operations: [{ as: "camille.p1@example.test", op: "AddTodo", input: { text: "Acheter du pain" } }],
  },
});
