import type { ResourceAccess, ResourceExpectation, ResourceLocator } from '@hachej/boring-files';
import type { SaveSelection } from './resources.js';

export interface TextDraftKey {
  readonly identity: Pick<ResourceAccess, 'principalId' | 'scopeId' | 'initiatorId'>;
  readonly providerInstanceId: string;
  readonly target: ResourceLocator;
  readonly format: string;
}

export interface TextDraftRef {
  readonly key: TextDraftKey;
  readonly base: ResourceExpectation;
  readonly writerId: string;
  readonly sequence: number;
}

export interface TextDraft {
  readonly version: 1;
  readonly ref: TextDraftRef;
  readonly text: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type TextDraftFailure = {
  readonly kind: 'denied' | 'expired' | 'unavailable' | 'unknown';
  readonly reason: string;
};

export interface TextDraftStore {
  readonly list: (key: TextDraftKey, limit: number) => Promise<{ readonly kind: 'available'; readonly drafts: readonly TextDraft[]; readonly truncated: boolean } | TextDraftFailure>;
  readonly write: (draft: TextDraft) => Promise<{ readonly kind: 'stored' | 'superseded' } | TextDraftFailure>;
  readonly remove: (ref: TextDraftRef) => Promise<{ readonly kind: 'removed' | 'missing' | 'superseded' } | TextDraftFailure>;
}

export interface TextDraftOptions {
  readonly store: TextDraftStore;
  readonly providerInstanceId: string;
  readonly signal: AbortSignal;
  readonly expiresAt: number;
  readonly retentionMs: number;
  readonly maxBytes?: number;
  readonly maxDrafts?: number;
}

export interface TextDraftBinding extends TextDraftOptions {
  readonly format: string;
  readonly validateText?: (text: string) => void;
}

export interface TextDraftChoiceSelection {
  readonly offerId: string;
  readonly draft: TextDraftRef;
  readonly viewer: SaveSelection;
  readonly observedCurrent: ResourceExpectation;
}

export interface TextDraftChoice {
  readonly selection: TextDraftChoiceSelection;
  readonly text: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly compatibility: 'exact' | 'conflict';
}

export type TextDraftDiscovery = { readonly kind: 'idle' | 'checking' | 'empty' }
  | { readonly kind: 'offered'; readonly choices: readonly TextDraftChoice[]; readonly truncated: boolean }
  | TextDraftFailure;

export type TextDraftCheckpoint = { readonly kind: 'idle' }
  | { readonly kind: 'pending' | 'stored'; readonly ref: TextDraftRef }
  | { readonly kind: 'failed'; readonly ref: TextDraftRef; readonly operation: 'write' | 'remove'; readonly result: TextDraftFailure };

export type TextDraftRecoveryState = { readonly kind: 'disabled' | 'revoked' | 'expired' | 'disposed' }
  | { readonly kind: 'active'; readonly checkpoint: TextDraftCheckpoint; readonly discovery: TextDraftDiscovery };

export type TextDraftChoiceFailure = TextDraftFailure | { readonly kind: 'conflict'; readonly reason: string };
export type TextDraftCheckpointResult = { readonly kind: 'stored'; readonly ref: TextDraftRef }
  | { readonly kind: 'clean' | 'superseded' }
  | TextDraftFailure;

export interface TextDraftActions {
  readonly checkDrafts: () => Promise<TextDraftDiscovery>;
  readonly checkpointDraft: () => Promise<TextDraftCheckpointResult>;
  readonly restoreDraft: (choice: TextDraftChoiceSelection) => Promise<{ readonly kind: 'restored'; readonly selection: SaveSelection } | TextDraftChoiceFailure>;
  readonly discardDraft: (choice: TextDraftChoiceSelection) => Promise<{ readonly kind: 'discarded' } | TextDraftChoiceFailure>;
}
