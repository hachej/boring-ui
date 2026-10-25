import type { Member } from '@hachej/boring-ui-kit/shared-chat';
import { defaultSharedLabels } from './shared-labels';
import type { SharedLabels } from './shared-labels';

/** The kinds of agent a thread tells apart: the app's assistant, the builder, any other. The words come from the labels (`sharedName`). */
export type AgentKind = 'assistant' | 'builder' | 'agent';

/** An id or a slug where a name should be (`agent:pm`, `user_1f3a…`, a uuid): never shown. */
const rawLike = (text: string) => /^[\w.-]+:[\w:.-]+$/.test(text) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text) || /^(?:user|usr|agent|person)[_-][\w-]+$/i.test(text);

export function agentKind(member: Pick<Member, 'id' | 'kind' | 'role'>): AgentKind | undefined {
  if (member.kind !== 'agent') return undefined;
  const words = `${member.role ?? ''} ${member.id}`.toLowerCase().split(/[^a-z0-9]+/);
  if (words.includes('builder') || words.includes('build')) return 'builder';
  if (words.includes('pm') || words.includes('assistant')) return 'assistant';
  return 'agent';
}

/** What a member is called in a thread: plain words, never an id. The assistant and the builder read as their role (`sharedName`). */
export function memberName(member: Pick<Member, 'id' | 'name' | 'kind' | 'role'>, words: SharedLabels['sharedName'] = defaultSharedLabels.sharedName): string {
  const kind = agentKind(member);
  if (kind === 'assistant' || kind === 'builder') return words(kind);
  const name = member.name?.trim();
  if (name && name !== member.id && !rawLike(name)) return name;
  return words(member.kind === 'agent' ? 'agent' : 'person');
}

const named = new WeakMap<SharedLabels['sharedName'], WeakMap<Member, Member>>();
/** The member with its display name; the same object for the same member (rows compare authors by identity). */
export function namedMember(member: Member, words: SharedLabels['sharedName'] = defaultSharedLabels.sharedName): Member {
  let cache = named.get(words);
  if (!cache) { cache = new WeakMap(); named.set(words, cache); }
  const found = cache.get(member);
  if (found) return found;
  const name = memberName(member, words);
  const result = name === member.name ? member : { ...member, name };
  cache.set(member, result);
  return result;
}

/** Names and avatars show only where they tell people apart: two or more members besides the reader (solo or a pair keeps the plain look). */
export function showsAuthors(members: readonly Pick<Member, 'id'>[], meId: string, presence?: boolean): boolean {
  return presence !== false && members.filter(member => member.id !== meId).length >= 2;
}

/** What sits above the first bubble of a run: the author of someone else's (when authors show), the « via » line of my own posted through an outside agent. */
export function runHead(row: { readonly first: boolean; readonly own: boolean; readonly authors: boolean; readonly via?: string | undefined }): 'author' | 'via' | undefined {
  if (!row.first) return undefined;
  if (row.own) return row.via ? 'via' : undefined;
  return row.authors ? 'author' : undefined;
}
