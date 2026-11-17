// cap-transcription AC-13: the page-side client is the kit's dictation callback, with no cast.
import type { DictationOptions } from '@hachej/boring-ui-kit/chat-react/voice';
import { transcribeClient } from '@hachej/boring-agent/caps/transcription-client';

export const transcribe: DictationOptions['transcribe'] = transcribeClient('/api/transcribe?language=fr');
