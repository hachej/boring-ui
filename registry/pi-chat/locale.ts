/* The languages the chat ships with. `locale` picks the base words; a host's `labels` still override any of them. */
import { defaultChatIcons, defaultChatText } from './labels';
import type { ChatText } from './labels';
import { frenchChatLabels } from './labels-fr';

export type ChatLocale = 'en' | 'fr';
const TEXT: Readonly<Record<ChatLocale, ChatText>> = { en: defaultChatText, fr: { labels: frenchChatLabels, icons: defaultChatIcons } };
/** The chat's base labels and icons for `locale` (English by default). */
export const chatTextFor = (locale: ChatLocale | undefined): ChatText => TEXT[locale ?? 'en'];
