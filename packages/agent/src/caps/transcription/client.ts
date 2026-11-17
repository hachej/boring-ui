// The page side of the kit's microphone: `DictationOptions["transcribe"]` posting the recording to the app's own transcription route.
// No provider code and no import: it restates the kit's callback type, so this package keeps its type-only edge to the kit.

/** `(audio, signal) => text`: POST to `url` with the recording's own type; a refusal throws `new Error(<kind>)`, so the kit shows its failed label. */
export function transcribeClient(url: string, init: RequestInit = {}): (audio: Blob, signal: AbortSignal) => Promise<string> {
  return async (audio, signal) => {
    const headers = new Headers(init.headers);
    headers.set('content-type', audio.type || 'audio/wav');
    const response = await fetch(url, { ...init, method: 'POST', headers, body: audio, signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `transcription ${response.status}`);
    return typeof body?.text === 'string' ? body.text : '';
  };
}
