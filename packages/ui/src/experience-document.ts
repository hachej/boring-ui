import type { ReadResult, ResourceLocator, ResourceSnapshot } from '@hachej/boring-files';
import type { PresentationResult } from './contracts.js';
import type { EditableViewerController, SaveResult, SaveSelection } from './resources.js';
import { createTextBuffer, freeze, sameBase } from './text-buffer.js';
import type { TextBufferOptions, TextBufferState } from './text-buffer.js';
import { validateExperience } from './experience-compose.js';
import type { ExperienceAccess, ExperienceDescriptor } from './experience-compose.js';
import type { ExperienceRegionTrigger } from './experience-regions.js';
import { experienceRegion, assertRegionReplacement } from './experience-region-tree.js';
import { replaceRegionText } from './experience-region-text.js';
import { randomUUID } from '@hachej/boring-files/platform';
import type { TextDraftActions, TextDraftOptions } from './text-draft-types.js';

export type ExperienceDocumentSource = { readonly kind: 'saved'; readonly snapshot: ResourceSnapshot }
  | { readonly kind: 'new'; readonly target: ResourceLocator; readonly descriptor?: unknown };
export interface ExperienceDocumentOptions extends Pick<TextBufferOptions, 'identity' | 'instanceId' | 'epoch' | 'client' | 'readOnly' | 'onListenerError'>, ExperienceAccess {
  readonly source: ExperienceDocumentSource;
  readonly drafts?: TextDraftOptions;
  readonly validateDocument?: (descriptor: Readonly<ExperienceDescriptor>) => void;
}
interface Proposal {
  readonly id: string;
  readonly base: SaveSelection;
  readonly descriptor: ExperienceDescriptor;
}
export type ExperienceProposal = Proposal & ({ readonly kind: 'layout' } | { readonly kind: 'region'; readonly region: string; readonly requestId: string });
export interface ExperienceRegionRequest {
  readonly id: string;
  readonly region: string;
  readonly trigger: ExperienceRegionTrigger;
  readonly base: SaveSelection;
}
export interface ExperienceDocumentState extends TextBufferState {
  readonly descriptor: ExperienceDescriptor | null;
  readonly problem: string | null;
  readonly proposal: ExperienceProposal | null;
  readonly pin: { readonly region: string; readonly selection: SaveSelection } | null;
}
type Subject = SaveSelection['target']['subject'];
export interface ExperienceDocumentActions extends TextDraftActions {
  readonly selection: () => SaveSelection;
  readonly propose: (base: SaveSelection, descriptor: unknown) => PresentationResult<void, Subject>;
  readonly beginRegion: (base: SaveSelection, region: string, trigger: ExperienceRegionTrigger) => PresentationResult<ExperienceRegionRequest, Subject>;
  readonly proposeRegion: (request: ExperienceRegionRequest, descriptor: unknown) => PresentationResult<void, Subject>;
  readonly pin: (selection: SaveSelection, signal?: AbortSignal) => Promise<SaveResult>;
  readonly adopt: (proposalId: string) => PresentationResult<SaveSelection, Subject>;
  readonly reject: (proposalId: string) => void;
  readonly refresh: () => Promise<ReadResult>;
  readonly discardToRemote: () => Promise<ReadResult>;
  readonly reconcile: () => Promise<SaveResult>;
}
export type ExperienceDocumentController = EditableViewerController<ExperienceDocumentState, ExperienceDocumentActions, undefined>;

export function createExperienceDocumentController(options: ExperienceDocumentOptions): ExperienceDocumentController {
  const parse = (text: string): ExperienceDescriptor => {
    const descriptor = validateExperience(JSON.parse(text), options);
    if (descriptor.source !== 'fixed') throw new TypeError('Saved experience must be fixed');
    options.validateDocument?.(freeze(descriptor));
    return descriptor;
  };
  const fixedText = (descriptor: ExperienceDescriptor): string => JSON.stringify({ ...descriptor, source: 'fixed' }) + '\n';
  const source = options.source.kind === 'saved' ? options.source : {
    kind: 'new' as const, target: options.source.target,
    text: options.source.descriptor === undefined ? '' : fixedText(validateExperience(options.source.descriptor, options)),
  };
  const { drafts, ...bufferOptions } = options;
  const buffer = createTextBuffer({ ...bufferOptions, ...(drafts ? { drafts: { ...drafts, format: 'experience/v1', validateText: (text: string): void => { parse(text); } } } : {}), source, mediaType: 'application/json',
    readText: snapshot => {
    if (snapshot.mediaType !== 'application/json') throw new TypeError('Expected an experience JSON document');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes);
    parse(text); return text;
  } });
  const decoded = (text: string): Pick<ExperienceDocumentState, 'descriptor' | 'problem'> => {
    if (!text) return { descriptor: null, problem: null };
    try { return { descriptor: parse(text), problem: null }; }
    catch { return { descriptor: null, problem: 'The selected layout is unavailable.' }; }
  };
  let state: ExperienceDocumentState = freeze({ ...buffer.getSnapshot(), ...decoded(buffer.getSnapshot().text), proposal: null, pin: null });
  let pinOrigin: { readonly region: string; readonly version: number } | null = null;
  let requestSequence = 0;
  const requests = new Map<string, ExperienceRegionRequest>();
  const listeners = new Set<() => void>();
  const update = (next: ExperienceDocumentState): void => {
    state = freeze(next);
    for (const listener of [...listeners]) {
      try { listener(); }
      catch (error) { queueMicrotask(() => { if (options.onListenerError) options.onListenerError(error); else throw error; }); }
    }
  };
  const unsubscribe = buffer.subscribe(() => {
    const next = buffer.getSnapshot();
    const view = next.text === state.text ? { descriptor: state.descriptor, problem: state.problem } : decoded(next.text);
    if (buffer.getSnapshot() === next) update({ ...next, ...view, proposal: state.proposal,
      pin: pinOrigin?.version === next.bufferVersion && next.dirty && next.lifecycle === 'active' ? { region: pinOrigin.region, selection: buffer.selection() } : null });
  });
  const selected = (selection: SaveSelection): boolean => {
    const current = buffer.selection().target, supplied = selection.target;
    return current.instanceId === supplied.instanceId && current.epoch === supplied.epoch
      && current.subject.scopeId === supplied.subject.scopeId && current.subject.bufferVersion === supplied.subject.bufferVersion
      && sameBase(current.subject.base, supplied.subject.base);
  };
  const propose: ExperienceDocumentActions['propose'] = (supplied, value) => {
    const base = freeze(structuredClone(supplied));
    if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (state.readOnly) return { kind: 'denied', reason: 'Layout document is read-only' };
    if (!selected(base)) return { kind: 'stale', reason: 'Proposal base has changed' };
    const descriptor = validateExperience(value, options);
    if (!selected(base) || buffer.getSnapshot().lifecycle === 'disposed') return { kind: 'stale', reason: 'Proposal base changed during validation' };
    const proposal = freeze({ kind: 'layout' as const, id: randomUUID(), base: structuredClone(base), descriptor });
    update({ ...state, proposal });
    return { kind: 'proposed', proposalId: proposal.id, base: proposal.base.target };
  };
  const currentRequest = (request: ExperienceRegionRequest): boolean => {
    const stored = requests.get(request.region);
    return stored?.id === request.id && stored.trigger === request.trigger && selected(stored.base) && selected(request.base);
  };
  const beginRegion: ExperienceDocumentActions['beginRegion'] = (base, region, trigger) => {
    if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (state.readOnly) return { kind: 'denied', reason: 'Layout document is read-only' };
    if (!selected(base)) return { kind: 'stale', reason: 'Region base has changed' };
    const request = freeze({ id: randomUUID(), base: structuredClone(base), region, trigger });
    const sequence = ++requestSequence;
    try {
      const descriptor = parse(buffer.getSnapshot().text), found = experienceRegion(descriptor, region);
      if (!found.props.regenerate.includes(trigger)) return { kind: 'denied', reason: 'Region trigger is not enabled' };
    } catch { return { kind: 'denied', reason: 'Region is unavailable' }; }
    if (sequence !== requestSequence || !selected(request.base) || buffer.getSnapshot().lifecycle === 'disposed') return { kind: 'stale', reason: 'Region changed during validation' };
    for (const [name, previous] of requests) if (!selected(previous.base)) requests.delete(name);
    requests.set(region, request);
    update({ ...state, proposal: state.proposal?.kind === 'region' && state.proposal.region === region ? null : state.proposal });
    return { kind: 'applied', value: request };
  };
  const proposeRegion: ExperienceDocumentActions['proposeRegion'] = (supplied, value) => {
    if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (state.readOnly) return { kind: 'denied', reason: 'Layout document is read-only' };
    if (!currentRequest(supplied)) return { kind: 'stale', reason: 'Region request or base has changed' };
    const request = requests.get(supplied.region);
    if (!request) return { kind: 'stale', reason: 'Region request has changed' };
    let descriptor: ExperienceDescriptor;
    try {
      const base = parse(buffer.getSnapshot().text);
      descriptor = validateExperience(value, options);
      assertRegionReplacement(base, descriptor, request.region);
    } catch { return { kind: 'denied', reason: 'Proposed region is unavailable' }; }
    if (!currentRequest(request) || buffer.getSnapshot().lifecycle === 'disposed') return { kind: 'stale', reason: 'Region changed during validation' };
    const proposal: ExperienceProposal = freeze({ kind: 'region', id: randomUUID(), base: structuredClone(request.base), descriptor, region: request.region, requestId: request.id });
    update({ ...state, proposal });
    return { kind: 'proposed', proposalId: proposal.id, base: proposal.base.target };
  };
  const adopt: ExperienceDocumentActions['adopt'] = proposalId => {
    if (state.lifecycle === 'disposed') return { kind: 'unavailable', reason: 'Viewer is disposed' };
    if (state.readOnly) return { kind: 'denied', reason: 'Layout document is read-only' };
    const proposal = state.proposal;
    if (!proposal || proposal.id !== proposalId || !selected(proposal.base)
      || proposal.kind === 'region' && requests.get(proposal.region)?.id !== proposal.requestId) return { kind: 'stale', reason: 'Offered layout or its base has changed' };
    let text: string;
    const before = buffer.getSnapshot();
    try {
      const descriptor = validateExperience(proposal.descriptor, options);
      text = proposal.kind === 'region' ? replaceRegionText(before.text, parse(before.text), descriptor, proposal.region) : fixedText(descriptor);
      if (proposal.kind === 'region') JSON.parse(text);
    }
    catch { return { kind: 'denied', reason: 'Offered layout is no longer available' }; }
    if (!selected(proposal.base) || state.proposal?.id !== proposalId || buffer.getSnapshot().lifecycle === 'disposed'
      || proposal.kind === 'region' && requests.get(proposal.region)?.id !== proposal.requestId) return { kind: 'stale', reason: 'Offered layout changed during validation' };
    const selection = freeze({ target: { ...proposal.base.target, subject: { ...proposal.base.target.subject, bufferVersion: proposal.base.target.subject.bufferVersion + 1 } } });
    pinOrigin = proposal.kind === 'region' && (!before.dirty || pinOrigin?.region === proposal.region && pinOrigin.version === before.bufferVersion)
      ? { region: proposal.region, version: selection.target.subject.bufferVersion } : null;
    state = freeze({ ...state, proposal: null });
    buffer.edit(text, true);
    return { kind: 'applied', value: selection };
  };
  const flush: ExperienceDocumentController['flush'] = (supplied, signal) => {
    const selection = freeze(structuredClone(supplied));
    const before = buffer.getSnapshot();
    if (before.lifecycle === 'disposed' || before.readOnly || !selected(selection) || before.save.kind === 'pending'
      || before.save.kind === 'settled' && before.save.result.kind === 'unknown') return buffer.flush(selection, signal);
    try { parse(before.text); }
    catch {
      if (buffer.getSnapshot() !== before) return buffer.flush(selection, signal);
      return Promise.resolve({ kind: 'denied', reason: 'The selected layout is unavailable for keeping' });
    }
    return buffer.flush(selection, signal);
  };
  const pin: ExperienceDocumentActions['pin'] = (selection, signal) => {
    const current = buffer.getSnapshot();
    if (current.lifecycle === 'disposed' || current.readOnly || !selected(selection) || current.save.kind === 'pending'
      || current.save.kind === 'settled' && current.save.result.kind === 'unknown') return buffer.flush(selection, signal);
    if (!state.pin || pinOrigin?.version !== current.bufferVersion) return Promise.resolve({ kind: 'denied', reason: 'Pin requires a draft containing only this region change' });
    return flush(selection, signal);
  };
  const refresh = async (discard: boolean): Promise<ReadResult> => {
    const result = await buffer.refresh(discard);
    if (result.kind === 'available' && state.problem && state.lifecycle !== 'disposed') {
      const current = buffer.getSnapshot(), view = decoded(current.text);
      if (buffer.getSnapshot() === current) update({ ...current, ...view, proposal: state.proposal, pin: state.pin });
    }
    return result;
  };
  return {
    getSnapshot: () => state,
    subscribe: listener => { if (state.lifecycle === 'disposed') return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    actions: {
      selection: buffer.selection, propose, adopt, beginRegion, proposeRegion, pin,
      checkDrafts: buffer.checkDrafts, checkpointDraft: buffer.checkpointDraft, discardDraft: buffer.discardDraft,
      restoreDraft: async choice => {
        const proposal = state.proposal, origin = pinOrigin, sequence = requestSequence;
        const priorRequests = new Map(requests);
        const result = await buffer.restoreDraft(choice);
        if (result.kind === 'restored') {
          if (pinOrigin === origin) pinOrigin = null;
          for (const [id, request] of priorRequests) if (requests.get(id) === request) requests.delete(id);
          if (requestSequence === sequence) requestSequence++;
          update({ ...state, proposal: state.proposal === proposal ? null : state.proposal, pin: pinOrigin ? state.pin : null });
        }
        return result;
      },
      reject: id => { if (state.lifecycle !== 'disposed' && state.proposal?.id === id) update({ ...state, proposal: null }); },
      refresh: () => refresh(false), discardToRemote: () => refresh(true), reconcile: buffer.reconcile,
    },
    tools: undefined, flush,
    dispose: () => { buffer.dispose(); unsubscribe(); listeners.clear(); requests.clear(); },
  };
}
