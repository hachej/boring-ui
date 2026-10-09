import { z } from 'zod';
import { layoutProps, experienceIdentifier as id } from './experience-catalog.js';

/**
 * Opaque per-composition id (32 hex characters). The headless experience entries must load without `@hachej/boring-files`
 * (README, `npm run test:experience-consumer`), so they do not import `randomUUID` from `@hachej/boring-files/platform`;
 * `crypto.getRandomValues` exists in every context, including plain-HTTP origins, so no secure-context fallback is needed.
 */
export function compositionId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

const boundedRecord = <Value extends z.ZodType>(value: Value, limit: number) => z.record(id, value).refine(record => Object.keys(record).length <= limit);
export const compositionDefinition = z.object({
  name: id, title: z.string().max(120).optional(), intents: boundedRecord(z.string().min(1).max(1200), 32),
  kinds: z.array(z.object({ kind: z.string().min(1).max(160), description: z.string().min(1).max(500),
    metadata: boundedRecord(z.array(z.string().min(1).max(80)).min(1).max(32), 16),
  })).max(128),
});
export const compositionCandidate = z.object({
  ref: layoutProps['boring/cell'].shape.ref, metadata: boundedRecord(z.string().max(80), 16),
  root: z.boolean().optional(), resource: z.string().min(1).max(512).optional(),
});
export const compositionLimits = z.object({ maxElements: z.number().int().min(1).max(200), maxDepth: z.number().int().min(1).max(24), maxEvaluations: z.number().int().min(1).max(32) });

