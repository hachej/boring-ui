import { createElement, useEffect, useRef, useState } from 'react';
import { Experience } from '@hachej/boring-ui-kit/experience';

const ids = ['amber', 'blue'];
const actorFields = ['principalId', 'initiatorId', 'scopeId', 'installationId'];
const refFields = ['appId', 'runtimeId', 'instanceId', 'capabilityVersion', ...actorFields,
  'requestId', 'producer', 'delivery', 'operationId'];
const requestFor = appId => ({ requestId: `${appId}-fixed-report`, inputRef: `${appId}:input:v1`, capabilityVersion: '1' });
const descriptor = {
  format: 'boring.experience', version: 1, name: 'fictional-hub', title: 'Fictional app reports', source: 'fixed',
  kinds: { 'boring/row': 1, 'boring/cell': 1, 'fictional/app-status': 1 }, root: 'root',
  elements: {
    root: { type: 'boring/row', props: { gap: 'medium' }, children: ids },
    amber: { type: 'boring/cell', props: { ref: 'amber/status' } },
    blue: { type: 'boring/cell', props: { ref: 'blue/status' } },
  },
};
const statuses = new Set(['pending', 'running', 'waiting', 'completing', 'completed', 'failed', 'aborted', 'orphaned', 'faulted']);
const publications = new Set(['committed', 'denied', 'conflict', 'invalid', 'producer-failed', 'unknown']);
const replies = new Set(['denied', 'conflict', 'unsupported', 'unknown', 'unavailable']);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 120;
const actorKey = actor => actor && actorFields.every(key => text(actor[key]))
  ? JSON.stringify(actorFields.map(key => actor[key])) : null;
const same = (left, right, fields) => fields.every(key => left?.[key] === right?.[key]);

function validRef(ref, appId, identity, actor) {
  const request = requestFor(appId);
  if (!ref || !identity || !same(ref, { ...identity, ...actor, ...request },
    ['appId', 'runtimeId', 'instanceId', ...actorFields, 'requestId', 'capabilityVersion'])
    || ![identity.appId, identity.runtimeId, identity.instanceId].every(text)
    || !Number.isSafeInteger(ref.producer) || ref.producer <= 0
    || !Number.isSafeInteger(ref.delivery) || ref.delivery <= 0 || ref.producer === ref.delivery
    || ref.operationId !== JSON.stringify([`${identity.runtimeId}:${identity.instanceId}`, ref.delivery])) return false;
  return true;
}

export function createFixtureHubView({ apps, actorFor, canView }) {
  const handles = Object.fromEntries(ids.map(id => [id, apps?.[id]]));
  const identities = Object.fromEntries(ids.map(id => [id, handles[id]?.identity &&
    Object.fromEntries(['appId', 'runtimeId', 'instanceId'].map(field => [field, handles[id].identity[field]]))]));
  const allowed = (appId, ref) => {
    try { return canView(ref) === true && actorKey(actorFor(appId)) !== null; }
    catch { return false; }
  };
  const currentActor = appId => {
    try { return actorFor(appId); } catch { return null; }
  };

  function StatusCell({ appId }) {
    const refName = `${appId}/status`, app = handles[appId], identity = identities[appId];
    const [display, setDisplay] = useState({ kind: 'idle' });
    const pending = useRef(0), generation = useRef(0);
    const actor = currentActor(appId), key = actorKey(actor), visible = allowed(appId, refName);
    const ready = visible && identity?.appId === appId && text(identity.runtimeId) && text(identity.instanceId)
      && same(app?.identity, identity, ['appId', 'runtimeId', 'instanceId'])
      && typeof app.invoke === 'function' && typeof app.observe === 'function';
    useEffect(() => {
      setDisplay({ kind: 'idle' });
      return () => { generation.current++; pending.current = 0; };
    }, [key, visible, ready]);
    const shown = ready && (display.kind === 'idle' || display.actorKey === key) ? display : { kind: 'unavailable' };
    const run = async action => {
      if (pending.current || !ready) return;
      const selectedActor = currentActor(appId), selectedKey = actorKey(selectedActor);
      const capturedActor = selectedKey && Object.fromEntries(actorFields.map(field => [field, selectedActor[field]]));
      if (!selectedKey || selectedKey !== key || !allowed(appId, refName)
        || actorKey(currentActor(appId)) !== selectedKey
        || !same(app.identity, identity, ['appId', 'runtimeId', 'instanceId'])) {
        setDisplay({ kind: 'unavailable' }); return;
      }
      if (action === 'observe' && !validRef(display.ref, appId, identity, selectedActor)) {
        setDisplay({ kind: 'unavailable' }); return;
      }
      const selectedReference = action === 'observe' ? { ...display.ref } : undefined;
      const serial = ++generation.current;
      pending.current = serial;
      setDisplay(previous => ({ ...previous, kind: 'pending', actorKey: selectedKey }));
      let reply;
      try {
        reply = action === 'invoke' ? await app.invoke(requestFor(appId), capturedActor)
          : await app.observe({ ...selectedReference }, capturedActor);
      } catch { reply = { kind: 'unknown' }; }
      if (pending.current === serial) pending.current = 0;
      const latestActor = currentActor(appId);
      if (serial !== generation.current) return;
      if (!allowed(appId, refName) || actorKey(latestActor) !== selectedKey
        || !same(app.identity, identity, ['appId', 'runtimeId', 'instanceId'])) {
        setDisplay({ kind: 'unavailable' }); return;
      }
      if (action === 'invoke') {
        setDisplay(reply?.kind === 'admitted' && validRef(reply.ref, appId, identity, latestActor)
          ? { kind: 'admitted', actorKey: selectedKey,
            ref: Object.fromEntries(refFields.map(field => [field, reply.ref[field]])) }
          : { kind: replies.has(reply?.kind) ? reply.kind : 'unknown', actorKey: selectedKey });
      } else {
        setDisplay(reply?.kind === 'observed' && validRef(reply.ref, appId, identity, latestActor)
          && same(reply.ref, selectedReference, refFields) && statuses.has(reply.status)
          && (reply.status === 'completed' ? publications.has(reply.publication) : reply.publication === undefined)
          ? { kind: 'observed', actorKey: selectedKey, ref: selectedReference, status: reply.status,
            publication: reply.publication }
          : { kind: reply?.kind === 'denied' ? 'denied' : 'unavailable', actorKey: selectedKey });
      }
    };
    return createElement('section', { 'aria-label': `${appId} report` },
      createElement('h2', null, `${appId} report`),
      createElement('p', { role: 'status' }, ready ? shown.kind === 'observed'
        ? `${shown.status}${shown.publication ? `: ${shown.publication}` : ''}` : shown.kind : 'unavailable'),
      ready && validRef(shown.ref, appId, identity, actor)
        ? createElement('p', { 'data-reference': appId, 'data-operation': shown.ref.operationId },
          `Request ${shown.ref.requestId}; operation ${shown.ref.operationId}`) : null,
      createElement('button', { type: 'button', disabled: !ready || !!pending.current, onClick: () => { void run('invoke'); } }, 'Run report'),
      createElement('button', { type: 'button', disabled: !ready || !!pending.current || !validRef(shown.ref, appId, identity, actor),
        onClick: () => { void run('observe'); } }, 'Check status'));
  }

  const cells = ids.map(appId => ({ ref: `${appId}/status`, kind: 'fictional/app-status', version: 1,
    render: () => createElement(StatusCell, { appId }) }));
  return function FixtureHubView() {
    return createElement(Experience, { descriptor, cells, canView: ref => ids.some(id => `${id}/status` === ref) });
  };
}
