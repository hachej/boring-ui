import { LIVE_PCM_FRAME_SAMPLES, LIVE_PCM_SAMPLE_RATE } from "../shared"

export const LIVE_TRANSCRIPT_WORKLET_NAME = "boring-live-transcript-pcm16"

export function createLiveTranscriptWorkletUrl(): string {
  const source = `
class BoringLiveTranscriptPcm16 extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.outputSampleRate = options.processorOptions?.outputSampleRate || ${LIVE_PCM_SAMPLE_RATE};
    this.frameSamples = options.processorOptions?.frameSamples || ${LIVE_PCM_FRAME_SAMPLES};
    this.input = [];
    this.position = 0;
    this.output = [];
    this.awaitingAck = false;
    // Two seconds of 100 ms frames absorbs tailnet/WebSocket ACK latency while
    // remaining strictly bounded in memory.
    this.queued = [];
    this.maxQueuedFrames = 20;
    this.failed = false;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "ack" || this.failed) return;
      this.awaitingAck = false;
      const frame = this.queued.shift();
      if (frame) this.send(frame);
    };
  }
  send(frame) {
    this.awaitingAck = true;
    this.port.postMessage({ type: "frame", data: frame }, [frame]);
  }
  emitFrame(frame) {
    if (!this.awaitingAck) return this.send(frame);
    if (this.queued.length < this.maxQueuedFrames) {
      this.queued.push(frame);
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
    const ratio = sampleRate / this.outputSampleRate;
    while (this.position + 1 < this.input.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = this.input[left] * (1 - fraction) + this.input[left + 1] * fraction;
      this.output.push(Math.max(-1, Math.min(1, sample)));
      this.position += ratio;
      if (this.output.length === this.frameSamples) {
        const frame = new ArrayBuffer(this.frameSamples * 2);
        const view = new DataView(frame);
        for (let index = 0; index < this.frameSamples; index += 1) {
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
