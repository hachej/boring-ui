import { LIVE_FRAMES_IN_FLIGHT, LIVE_PCM_FRAME_SAMPLES, LIVE_PCM_SAMPLE_RATE } from "../shared"

export const LIVE_TRANSCRIPT_WORKLET_NAME = "boring-live-transcript-pcm16"

/** Worklet processor source; exported so tests can run it outside a browser. */
export const LIVE_TRANSCRIPT_WORKLET_SOURCE = `
class BoringLiveTranscriptPcm16 extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.outputSampleRate = options.processorOptions?.outputSampleRate || ${LIVE_PCM_SAMPLE_RATE};
    this.frameSamples = options.processorOptions?.frameSamples || ${LIVE_PCM_FRAME_SAMPLES};
    this.input = [];
    this.position = 0;
    this.output = [];
    // Sliding window: up to maxInFlight frames may await a server ACK, so
    // throughput is maxInFlight frames per round trip instead of one. The
    // queue behind it absorbs jitter and stays strictly bounded in memory.
    this.maxInFlight = options.processorOptions?.maxInFlight || ${LIVE_FRAMES_IN_FLIGHT};
    this.inFlight = 0;
    this.queued = [];
    this.maxQueuedFrames = 30;
    this.failed = false;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "ack" || this.failed) return;
      this.inFlight = Math.max(0, this.inFlight - 1);
      const frame = this.queued.shift();
      if (frame) this.send(frame);
    };
  }
  send(frame) {
    this.inFlight += 1;
    this.port.postMessage({ type: "frame", data: frame }, [frame]);
  }
  emitFrame(frame) {
    if (this.inFlight < this.maxInFlight) return this.send(frame);
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

export function createLiveTranscriptWorkletUrl(): string {
  return URL.createObjectURL(new Blob([LIVE_TRANSCRIPT_WORKLET_SOURCE], { type: "text/javascript" }))
}
