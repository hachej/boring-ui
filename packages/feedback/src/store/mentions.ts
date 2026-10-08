import type { ResourceAccess } from '@hachej/boring-files';
import { FEEDBACK_ID, serializeFeedback } from '../format/index.js';
import type { FeedbackStore } from './store.js';

/** Structurally the `MentionFile` of `@hachej/boring-agent` (`packages/agent/src/mentions.ts`), which this folder may not import. */
export interface FeedbackMentionFile { readonly size: number; readonly bytes?: Uint8Array }
/** Structurally a `MentionReader`: undefined when the path is not a readable report. Never throws. */
export type FeedbackMentionReader = (path: string) => Promise<FeedbackMentionFile | undefined>;

/**
 * A mention reader for `@<root><id>.md`: the same read authorization as `store.read`, on the report's subject, with access
 * resolved per read. Mention paths are taken as resource paths, so the host mounts the root at the same workspace-relative
 * path it gives the store; any other path is not this reader's and returns undefined (compose it in
 * front of the host's file reader). The bytes are the canonical serialization of the stored report.
 */
export function feedbackMentionReader<Context>(store: Pick<FeedbackStore<Context>, 'root' | 'read'>, resolveAccess: () => ResourceAccess | Promise<ResourceAccess>): FeedbackMentionReader {
  const prefix = store.root.path;
  return async path => {
    try {
      if (typeof path !== 'string' || !path.startsWith(prefix) || !path.endsWith('.md')) return undefined;
      const id = path.slice(prefix.length, -'.md'.length);
      if (!FEEDBACK_ID.test(id)) return undefined;
      const read = await store.read(id, await resolveAccess());
      if (read.kind !== 'available') return undefined;
      const bytes = serializeFeedback(read.report);
      return { size: bytes.length, bytes };
    } catch { return undefined; }
  };
}
