import type { ResourceAccess, ResourceExpectation } from '@hachej/boring-files';
import type { SaveResult } from './resources.js';
import type { TextDraftRecoveryState } from './text-draft-types.js';

export interface TextBufferState {
  readonly identity: Pick<ResourceAccess, 'scopeId' | 'principalId' | 'initiatorId'>;
  readonly text: string;
  readonly base: ResourceExpectation;
  readonly readOnly: boolean;
  readonly bufferVersion: number;
  readonly dirty: boolean;
  readonly lifecycle: 'active' | 'disposed';
  readonly save: { readonly kind: 'idle' } | { readonly kind: 'pending'; readonly operationId: string }
    | { readonly kind: 'settled'; readonly result: SaveResult };
  readonly remote: ResourceExpectation | null;
  readonly recovery: TextDraftRecoveryState;
}
