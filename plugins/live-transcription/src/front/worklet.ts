import { LIVE_PCM_FRAME_SAMPLES, LIVE_PCM_SAMPLE_RATE } from "../shared"

export const LIVE_TRANSCRIPT_WORKLET_NAME = "boring-live-transcript-pcm16"

export function createLiveTranscriptWorkletUrl(): string {
  const source = `
class BoringLiveTranscriptPcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.input = [];
    this.position = 0;
    this.output = [];
    this.awaitingAck = false;
    this.queued = null;
    this.failed = false;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "ack" || this.failed) return;
      this.awaitingAck = false;
      if (this.queued) {
        const frame = this.queued;
        this.queued = null;
        this.send(frame);
      }
    };
  }
  send(frame) {
    this.awaitingAck = true;
    this.port.postMessage({ type: "frame", data: frame }, [frame]);
  }
  emitFrame(frame) {
    if (!this.awaitingAck) return this.send(frame);
    if (!this.queued) {
      this.queued = frame;
      return;
    }
    this.failed = true;
    this.port.postMessage({ type: "overflow" });
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.failed) return true;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = Math.min(...channels.map((channel) => channel.length));
    for (let index = 0; index < length; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      this.input.push(sample / channels.length);
    }
    const ratio = sampleRate / ${LIVE_PCM_SAMPLE_RATE};
    while (this.position + 1 < this.input.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = this.input[left] * (1 - fraction) + this.input[left + 1] * fraction;
      this.output.push(Math.max(-1, Math.min(1, sample)));
      this.position += ratio;
      if (this.output.length === ${LIVE_PCM_FRAME_SAMPLES}) {
        const frame = new ArrayBuffer(${LIVE_PCM_FRAME_SAMPLES * 2});
        const view = new DataView(frame);
        for (let index = 0; index < ${LIVE_PCM_FRAME_SAMPLES}; index += 1) {
          const value = this.output[index];
          const pcm = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
          view.setInt16(index * 2, pcm, true);
        }
        this.output = [];
        this.emitFrame(frame);
      }
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, this.input.length - 1));
    if (consumed > 0) {
      this.input.splice(0, consumed);
      this.position -= consumed;
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(LIVE_TRANSCRIPT_WORKLET_NAME)}, BoringLiveTranscriptPcm16);
`
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
}
