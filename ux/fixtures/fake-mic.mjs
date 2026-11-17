// The fake microphone of the demos: no real device, so the dictation button works on any page (an http page has no `navigator.mediaDevices`).
// getUserMedia hands out one track, MediaRecorder hands over one chunk when it stops. Web Audio is removed so the kit's capture takes the MediaRecorder path.
// `slow`: the first open takes 700 ms, as a real phone's first open does (permission, device start); the next ones are instant.
export function installFakeMic({ slow = false } = {}) {
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
  Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  let opened = false;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    if (slow && !opened) await new Promise(done => setTimeout(done, 700));
    opened = true;
    const track = { stop() {} };
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } });
  window.MediaRecorder = class FakeRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const chunk = new Event('dataavailable'); chunk.data = new Blob(['fictional audio'], { type: 'audio/webm' }); this.dispatchEvent(chunk);
      this.dispatchEvent(new Event('stop'));
    }
  };
}
