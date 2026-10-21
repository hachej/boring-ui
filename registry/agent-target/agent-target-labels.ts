import { chatTextFor } from '../pi-chat/locale';
import type { DictationLabels } from '../app-shell/use-dictation';

export interface AgentTargetLabels extends DictationLabels {
  readonly title: string;
  readonly opening: string;
  readonly listening: (seconds: number) => string;
  readonly transcribing: string;
  readonly waiting: string;
  readonly answered: string;
  readonly stop: string;
  readonly cancel: string;
  readonly close: string;
  readonly invalidContext: string;
  readonly contextTooLarge: string;
  readonly observationFailed: string;
  readonly unanswered: string;
  readonly unavailable: string;
  readonly sendFailed: string;
  readonly unconfirmed: string;
}

export const agentTargetLabels: AgentTargetLabels = {
  ...chatTextFor(undefined).labels,
  title: 'Talk about this item',
  opening: 'Opening microphone…',
  listening: seconds => `Listening… ${seconds}s`,
  transcribing: 'Transcribing…',
  waiting: 'Waiting for the agent…',
  answered: 'Request answered.',
  stop: 'Stop and send',
  cancel: 'Cancel',
  close: 'Close',
  invalidContext: 'Target context must be a JSON object.',
  contextTooLarge: 'Target context exceeds 1 KB.',
  observationFailed: 'Could not confirm the reply. Open chat to check it.',
  unanswered: 'The agent did not answer this request.',
  unavailable: 'The chat is no longer available.',
  sendFailed: 'The request could not be sent. Your words are in the chat draft.',
  unconfirmed: 'The request was not confirmed. Check the chat before trying again.',
};

export const agentTargetLabelsFr: AgentTargetLabels = {
  ...agentTargetLabels,
  ...chatTextFor('fr').labels,
  title: 'Parler de cet élément',
  opening: 'Ouverture du microphone…',
  listening: seconds => `J’écoute… ${seconds} s`,
  transcribing: 'Transcription…',
  waiting: 'Réponse en cours…',
  answered: 'Demande traitée.',
  stop: 'Arrêter et envoyer',
  cancel: 'Annuler',
  close: 'Fermer',
  invalidContext: 'Le contexte doit être un objet JSON.',
  contextTooLarge: 'Le contexte dépasse 1 Ko.',
  observationFailed: 'Réponse non confirmée. Ouvrez la discussion pour la vérifier.',
  unanswered: 'L’assistant n’a pas répondu à cette demande.',
  unavailable: 'La discussion n’est plus disponible.',
  sendFailed: 'Envoi impossible. Vos mots sont conservés dans le brouillon de la discussion.',
  unconfirmed: 'Envoi non confirmé. Vérifiez la discussion avant de réessayer.',
};
