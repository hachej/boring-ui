import { randomUUID, sha256 } from '@hachej/boring-files/platform';

function canonical(value, depth = 0) {
  if (depth > 32) throw new TypeError('Action is too deeply nested');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.isWellFormed()) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => {
      if (!key.isWellFormed()) throw new TypeError('Invalid action key');
      return [key, canonical(value[key], depth + 1)];
    }));
  }
  throw new TypeError('Expected a JSON action');
}

async function digest(nonce, action, consultationId, actor, payload) {
  if (!['correct', 'adopt'].includes(action) || !['first', 'second'].includes(consultationId)) throw new TypeError('Unknown action owner');
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(['fictional.redaction.browser.v1', nonce, action, consultationId, actor, payload])));
  if (bytes.length > 32768) throw new TypeError('Action is too large');
  return Array.from(await sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createActionRequestId(action, consultationId, actor, payload) {
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
  return `${nonce}-${await digest(nonce, action, consultationId, actor, payload)}`;
}

export async function matchesActionRequestId(requestId, action, consultationId, actor, payload) {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{12}-[0-9a-f]{64}$/.test(requestId)) return false;
  try { return requestId.slice(13) === await digest(requestId.slice(0, 12), action, consultationId, actor, payload); }
  catch { return false; }
}
