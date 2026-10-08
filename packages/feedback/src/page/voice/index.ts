// Voice in a feedback session: the microphone capture and the alignment of what was said with where the pointer was.
export {
  createVoiceCapture, browserGetUserMedia, DEFAULT_MAX_VOICE_MS, VOICE_MIME_TYPES, VOICE_REFUSALS,
  type VoiceCapture, type VoiceRefusal, type VoiceCaptureOptions, type VoiceStart, type VoiceRecording,
} from './capture.js';
export { alignSpeech, PIN_AFTER_MS, type SpeechSegment, type SpeechWord, type PointerSample, type PinMark, type AlignedSpeech } from './align.js';
