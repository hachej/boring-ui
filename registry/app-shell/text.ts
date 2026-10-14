// The app shell's own words (the AgentLayer's and the screen layout's). The language is the agent's chat language (`agent.chatProps.locale`), not a prop of the layer; this follows
// pi-chat's labels.ts / labels-fr.ts pattern (a fixed set of keys per language, checked to have the same keys).
export type AppShellLocale = 'en' | 'fr';

export interface AppShellText {
  readonly close: string;
  readonly expand: string;
  readonly collapse: string;
  /** « ← » back to the assistant from the improve view. */
  readonly back: string;
  readonly listening: string;
  /** The account-menu entry that opens the product manager in the layer. */
  readonly improve: string;
  /** The hero button: hold it and talk. */
  readonly holdToTalk: string;
  /** The title of the agent when the host gives the chat none. */
  readonly assistant: string;
  /** The header trigger that opens the layer. */
  readonly open: string;
  /** The fourth tab when there are more than four screens, and the title of its sheet. */
  readonly more: string;
  readonly signOut: string;
  /** The account sheet's title (the person's name is shown once, in the person block) and the sidebar's name when there is none. */
  readonly account: string;
  /** The header's « … » button. */
  readonly actions: string;
  /** The account menu's theme switch. */
  readonly darkMode: string;
  /** The label of the tab bar. */
  readonly tabs: string;
  /** The « ← » of a header. */
  readonly goBack: string;
  /** The dock controls of the wide layer: float it over the app, or dock it on a side. */
  readonly float: string;
  readonly dockLeft: string;
  readonly dockRight: string;
}

const en: AppShellText = {
  close: 'Close',
  expand: 'Expand',
  collapse: 'Collapse',
  back: 'Back to the assistant',
  listening: 'Listening…',
  improve: 'Improve the app',
  holdToTalk: 'Hold and talk',
  assistant: 'Assistant',
  open: 'Open the assistant',
  more: 'More',
  signOut: 'Sign out',
  account: 'Account',
  actions: 'More actions',
  darkMode: 'Dark mode',
  tabs: 'Navigation',
  goBack: 'Back',
  float: 'Float over the app',
  dockLeft: 'Dock on the left',
  dockRight: 'Dock on the right',
};

const fr: AppShellText = {
  close: 'Fermer',
  expand: 'Agrandir',
  collapse: 'Réduire',
  back: 'Retour à l’assistant',
  listening: 'J’écoute…',
  improve: 'Améliorer l’app',
  holdToTalk: 'Appuie et parle',
  assistant: 'Assistant',
  open: 'Ouvrir l’assistant',
  more: 'Plus',
  signOut: 'Se déconnecter',
  account: 'Compte',
  actions: 'Plus d’actions',
  darkMode: 'Mode sombre',
  tabs: 'Navigation',
  goBack: 'Retour',
  float: 'Flotter sur l’app',
  dockLeft: 'Ancrer à gauche',
  dockRight: 'Ancrer à droite',
};

const TEXT: Readonly<Record<AppShellLocale, AppShellText>> = { en, fr };

/** The layer's words for `locale` (English by default). */
export const appShellText = (locale: AppShellLocale | undefined): AppShellText => TEXT[locale ?? 'en'];
