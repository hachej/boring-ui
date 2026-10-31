import type { AudienceLocale } from './audience-labels';

export const defaultOutreachLabels = {
  outreachTitle: 'Outreach', outreachHint: 'Written from the app’s own address. Each message goes out only when you confirm it.',
  unavailable: 'Outreach is not switched on for this app yet. Ask the platform team.',
  footerTitle: 'Who is writing', footerHint: 'Printed at the bottom of every message, with an unsubscribe link. Nothing can be sent before all three are filled.',
  name: 'Name', company: 'Company', postal: 'Postal address', saveFooter: 'Save', footerMissing: 'Fill in who is writing first.',
  draft: 'Draft', noDrafts: 'No draft yet', noDraftsDescription: 'Add a file to documents/outreach, with a Subject line, then the text.',
  recipients: 'Recipients', noRecipients: 'No recipient yet', recipient: 'Address', link: 'Link id', send: 'Send…', alreadySent: 'Already sent',
  quota: (left: number, max: number) => `${left} of ${max} sends left today`,
  confirmTitle: 'Send this message?', confirmDescription: 'It goes out exactly as shown, once, from the app’s address.', from: 'From', to: 'To', subject: 'Subject',
  confirm: 'Send now', cancel: 'Cancel', sending: 'Sending', preparing: 'Checking',
  sentOk: 'Sent', failed: 'It could not be sent.',
  logTitle: 'Send log', logEmpty: 'Nothing sent yet', when: 'When', status: 'Status', messageId: 'Message id',
  statuses: { sent: 'Sent', uncertain: 'Not confirmed', delivering: 'Sending', suppressed: 'Refused', failed: 'Failed' } as Record<string, string>,
  errors: {
    footer_missing: 'Fill in who is writing first.', suppressed: 'This address asked not to be written to again.', over_budget: 'Today’s 20 sends are used.',
    confirm_required: 'The confirmation expired. Start again.', unconfigured: 'Outreach is not switched on for this app.', 'delivery-uncertain': 'The delivery could not be confirmed. Check the log before sending again.',
  } as Record<string, string>,
  inboxTitle: 'Inbox', inboxEmpty: 'No reply yet', inboxEmptyDescription: 'Replies to your messages arrive here.', unread: (n: number) => `${n} new`,
  from2: 'From', last: 'Last', open: 'Open', reply: 'Reply', replyPlaceholder: 'Your answer', review: 'Review the answer', close: 'Close',
  incoming: 'Received', outgoing: 'You', notAVerifiedSender: 'The sender’s address is not verified.',
  formatTime: (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' '),
};
export type OutreachLabels = typeof defaultOutreachLabels;

const timeFormat = (locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return (ms: number) => formatter.format(new Date(ms));
};

export const frenchOutreachLabels: OutreachLabels = {
  outreachTitle: 'Prospection', outreachHint: 'Écrit depuis l’adresse de l’app. Chaque message part seulement quand vous le confirmez.',
  unavailable: 'La prospection n’est pas encore activée pour cette app. Demandez à l’équipe plateforme.',
  footerTitle: 'Qui écrit', footerHint: 'Imprimé en bas de chaque message, avec un lien de désinscription. Rien ne part tant que les trois champs ne sont pas remplis.',
  name: 'Nom', company: 'Société', postal: 'Adresse postale', saveFooter: 'Enregistrer', footerMissing: 'Renseignez d’abord qui écrit.',
  draft: 'Brouillon', noDrafts: 'Aucun brouillon', noDraftsDescription: 'Ajoutez un fichier dans documents/outreach, avec une ligne Subject, puis le texte.',
  recipients: 'Destinataires', noRecipients: 'Aucun destinataire', recipient: 'Adresse', link: 'Id du lien', send: 'Envoyer…', alreadySent: 'Déjà envoyé',
  quota: (left, max) => `${left} envois restants sur ${max} aujourd’hui`,
  confirmTitle: 'Envoyer ce message ?', confirmDescription: 'Il part exactement comme affiché, une seule fois, depuis l’adresse de l’app.', from: 'De', to: 'À', subject: 'Objet',
  confirm: 'Envoyer maintenant', cancel: 'Annuler', sending: 'Envoi', preparing: 'Vérification',
  sentOk: 'Envoyé', failed: 'Le message n’a pas pu être envoyé.',
  logTitle: 'Journal d’envoi', logEmpty: 'Rien d’envoyé pour l’instant', when: 'Quand', status: 'Statut', messageId: 'Id du message',
  statuses: { sent: 'Envoyé', uncertain: 'Non confirmé', delivering: 'En cours', suppressed: 'Refusé', failed: 'Échec' },
  errors: {
    footer_missing: 'Renseignez d’abord qui écrit.', suppressed: 'Cette adresse a demandé à ne plus être contactée.', over_budget: 'Les 20 envois du jour sont utilisés.',
    confirm_required: 'La confirmation a expiré. Recommencez.', unconfigured: 'La prospection n’est pas activée pour cette app.', 'delivery-uncertain': 'L’envoi n’a pas pu être confirmé. Vérifiez le journal avant de renvoyer.',
  },
  inboxTitle: 'Boîte de réception', inboxEmpty: 'Aucune réponse', inboxEmptyDescription: 'Les réponses à vos messages arrivent ici.', unread: (n) => `${n} nouveau${n > 1 ? 'x' : ''}`,
  from2: 'De', last: 'Dernier', open: 'Ouvrir', reply: 'Répondre', replyPlaceholder: 'Votre réponse', review: 'Relire la réponse', close: 'Fermer',
  incoming: 'Reçu', outgoing: 'Vous', notAVerifiedSender: 'L’adresse de l’expéditeur n’est pas vérifiée.',
  formatTime: timeFormat('fr'),
};

export function outreachLabelsFor(locale: AudienceLocale | undefined, overrides: Partial<OutreachLabels> = {}): OutreachLabels {
  const base = locale === 'fr' ? frenchOutreachLabels : { ...defaultOutreachLabels, formatTime: timeFormat('en') };
  return { ...base, ...overrides };
}
