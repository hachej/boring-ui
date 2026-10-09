// Host-provided voice input for the ambient bar's `tools` slot. Microphone access (getUserMedia) exists only in secure contexts
// (https or localhost) and needs the person's permission, so the shared component never includes it: this host feature-detects first
// and renders no button when it is missing. `npm run check` allowlists this file on that condition.

export const micSupported = () => typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function';

/** Opens the microphone after the person's click and returns the function that closes it. Rejects when permission is refused. */
export async function openMicrophone() {
  if (typeof globalThis.navigator?.mediaDevices?.getUserMedia !== 'function') throw new Error('The microphone is not available on this page');
  const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
  return () => { for (const track of stream.getTracks()) track.stop(); };
}
