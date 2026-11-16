// A second, different app: a to-do list. One model, two operations, one view, one assistant skill. No files, no reader, no sub-agent.
import { defineApp } from "../../contract/define-app.ts";
import { agents } from "./agents.ts";
import { TodoApi, TodoModel, TodosLive } from "./models/Todos.model.ts";

export default defineApp({
  name: "todo", title: "Tâches",
  models: [TodoModel], handlers: TodosLive, api: TodoApi,
  expose: { page: ["AddTodo", "CompleteTodo", "Todos.get"], mcp: ["Todos.get", "AddTodo"], assistant: ["AddTodo", "CompleteTodo", "Todos.get"] },
  views: [{ id: "todos", nav: "Tâches", component: "./web/TodosView.tsx" }],
  agents, skills: "./skills",
  seed: {
    people: [{ name: "Camille Martin", email: "camille.p4@example.test" }, { name: "Dominique Leroy", email: "dominique.p4@example.test" }, { name: "Edgar Faure", email: "edgar.p4@example.test" }],
    operations: [{ as: "camille.p4@example.test", op: "AddTodo", input: { text: "Acheter du pain" } }],
  },
});
