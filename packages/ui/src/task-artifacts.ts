/** A host-owned task reference, not a file, execution task, permission or mutation. */
export type TaskSubject = { readonly task: string } | { readonly tasks: { readonly filter: 'all' | 'mine' | 'waiting-on-me' } };

export interface TaskArtifactDescriptor {
  readonly schema: 'boring.task';
  readonly version: 1;
  readonly type: 'task';
  readonly title: string;
  readonly subject: TaskSubject;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Strict, detached reference parsing; the host still authenticates and resolves the task. */
export function parseTaskSubject(value: unknown): TaskSubject | undefined {
  if (!object(value)) return undefined;
  if (only(value, ['task']) && typeof value['task'] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value['task'])) return { task: value['task'] };
  const tasks = value['tasks'];
  if (!only(value, ['tasks']) || !object(tasks) || !only(tasks, ['filter'])) return undefined;
  const filter = tasks['filter'];
  return filter === 'all' || filter === 'mine' || filter === 'waiting-on-me' ? { tasks: { filter } } : undefined;
}

/** The browser and server use the same exact subject identity for presentation acknowledgements. */
export function taskSubjectKey(subject: TaskSubject): string {
  return 'task' in subject ? JSON.stringify(['task', subject.task]) : JSON.stringify(['tasks', subject.tasks.filter]);
}

export function parseTaskArtifact(value: unknown): TaskArtifactDescriptor | undefined {
  if (!object(value) || !only(value, ['schema', 'version', 'type', 'title', 'subject'])) return undefined;
  if (value['schema'] !== 'boring.task' || value['version'] !== 1 || value['type'] !== 'task') return undefined;
  const title = value['title'], subject = parseTaskSubject(value['subject']);
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || !subject) return undefined;
  return { schema: 'boring.task', version: 1, type: 'task', title, subject };
}

export function createTaskArtifact(subject: TaskSubject): TaskArtifactDescriptor {
  const parsed = parseTaskSubject(subject);
  if (!parsed) throw new TypeError('Invalid task subject');
  return { schema: 'boring.task', version: 1, type: 'task', title: 'task' in parsed ? parsed.task : parsed.tasks.filter === 'mine' ? 'My requests' : parsed.tasks.filter === 'waiting-on-me' ? 'Waiting on me' : 'Tasks', subject: parsed };
}
