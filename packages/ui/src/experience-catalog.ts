import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';

export const experienceIdentifier = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80).refine(value => !Object.hasOwn(Object.prototype, value), 'Reserved element identifier');
export const layoutProps = {
  'boring/stack': z.strictObject({ gap: z.enum(['small', 'medium', 'large']).default('medium') }),
  'boring/row': z.strictObject({ gap: z.enum(['small', 'medium', 'large']).default('medium') }),
  'boring/grid': z.strictObject({ columns: z.number().int().min(1).max(4), gap: z.enum(['small', 'medium', 'large']).default('medium') }),
  'boring/cell': z.strictObject({ ref: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/).max(160) }),
  'boring/generated': z.strictObject({ region: experienceIdentifier, candidates: z.array(z.string().min(1).max(160)).max(128),
    kinds: z.array(z.string().min(1).max(160)).max(128).optional(), maxElements: z.number().int().min(1).max(200).default(64),
    minWidth: z.number().int().min(0).max(4096).default(0), regenerate: z.array(z.enum(['open', 'phase', 'request'])).max(3).default(['request']),
    prompt: z.string().min(1).max(1200).optional(),
  }),
};

export const experienceCatalog = defineCatalog(schema, {
  components: {
    'boring/stack': { props: layoutProps['boring/stack'], slots: ['default'], description: 'Vertical layout' },
    'boring/row': { props: layoutProps['boring/row'], slots: ['default'], description: 'Wrapping horizontal layout' },
    'boring/grid': { props: layoutProps['boring/grid'], slots: ['default'], description: 'Bounded column layout' },
    'boring/cell': { props: layoutProps['boring/cell'], slots: [], description: 'Host-owned cell reference' },
    'boring/generated': { props: layoutProps['boring/generated'], slots: ['default'], description: 'Bounded generated region with saved defaults' },
  },
  actions: {},
});
