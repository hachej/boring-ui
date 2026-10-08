import { z } from 'zod';

export const taskListKind = 'fictional.task-list';
export const taskListVersion = 1;
export const taskListMediaType = 'application/vnd.fictional.task-list+json';
const encoder = new TextEncoder();
const text = (maximum: number) => z.string().min(1).refine(value => encoder.encode(value).length <= maximum
  && !/[\uD800-\uDFFF]/u.test(value) && value.trim().length > 0);
const id = text(128), title = text(2048);
const item = z.object({ id, title, completed: z.boolean() }).strict();
const documentSchema = z.object({ kind: z.literal(taskListKind), version: z.literal(taskListVersion), items: z.array(item).max(100) }).strict()
  .refine(value => new Set(value.items.map(entry => entry.id)).size === value.items.length, 'Duplicate task ID');
const operationsSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), id, title }).strict(),
  z.object({ kind: z.literal('rename'), id, title }).strict(),
  z.object({ kind: z.literal('set-completed'), id, completed: z.boolean() }).strict(),
  z.object({ kind: z.literal('remove'), id }).strict(),
])).min(1).max(100);
export interface TaskListDocument {
  readonly kind: typeof taskListKind;
  readonly version: typeof taskListVersion;
  readonly items: readonly Readonly<z.infer<typeof item>>[];
}
export type TaskListOperation = Readonly<z.infer<typeof operationsSchema>[number]>;
function bounded(text: string): string {
  if (encoder.encode(text).length > 65_536) throw new TypeError('Task list exceeds 65536 bytes');
  return text;
}
export function parseTaskList(value: unknown): TaskListDocument {
  const parsed = documentSchema.parse(value);
  bounded(JSON.stringify(parsed));
  return Object.freeze({ ...parsed, items: Object.freeze(parsed.items.map(entry => Object.freeze(entry))) });
}
export function parseTaskListOperations(value: unknown): readonly TaskListOperation[] {
  const parsed = operationsSchema.parse(value);
  bounded(JSON.stringify(parsed));
  return Object.freeze(parsed.map(operation => Object.freeze(operation)));
}
export function readTaskList(text: string): TaskListDocument { return parseTaskList(JSON.parse(bounded(text))); }
export function serializeTaskList(document: TaskListDocument): string { return bounded(JSON.stringify(parseTaskList(document))); }
export function emptyTaskList(): TaskListDocument { return parseTaskList({ kind: taskListKind, version: taskListVersion, items: [] }); }
export function applyTaskListOperations(document: TaskListDocument, operations: readonly TaskListOperation[]): TaskListDocument {
  const items = parseTaskList(document).items.map(entry => ({ ...entry }));
  for (const operation of parseTaskListOperations(operations)) {
    const position = items.findIndex(entry => entry.id === operation.id);
    if (operation.kind === 'add') {
      if (position !== -1) throw new TypeError('Task ID already exists');
      items.push({ id: operation.id, title: operation.title, completed: false });
    } else {
      const current = items[position];
      if (!current) throw new TypeError('Task ID does not exist');
      switch (operation.kind) {
        case 'rename': items[position] = { ...current, title: operation.title }; break;
        case 'set-completed': items[position] = { ...current, completed: operation.completed }; break;
        case 'remove': items.splice(position, 1); break;
      }
    }
  }
  return parseTaskList({ kind: taskListKind, version: taskListVersion, items });
}
