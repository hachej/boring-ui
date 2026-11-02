// The Spaces block's words, in English and French. A host names what a space is through its own labels.

export interface SpacesLabels {
  readonly choose: (label: string) => string;
  readonly noSpaces: string;
  readonly membersDescription: string;
  readonly members: string;
  readonly you: string;
  readonly role: string;
  readonly remove: string;
  readonly invite: string;
  readonly email: string;
  readonly emailPlaceholder: string;
  readonly createLink: string;
  readonly copy: string;
  readonly inviteHint: string;
  readonly adminAccess: string;
  readonly adminAccessEntry: (entry: { readonly at: string; readonly reason: string; readonly write: boolean }) => string;
  readonly leave: string;
  /** What a refusal of the host means, by its code. A code missing here shows the error's own message. */
  readonly errors: Readonly<Record<string, string>>;
}

export const spacesLabels: SpacesLabels = {
  choose: label => `Choose: ${label.toLowerCase()}`,
  noSpaces: 'None yet.',
  membersDescription: 'Who can open this space, and with which role.',
  members: 'Members',
  you: ' (you)',
  role: 'Role',
  remove: 'Remove',
  invite: 'Invite someone',
  email: 'Email',
  emailPlaceholder: 'name@example.com',
  createLink: 'Create the link',
  copy: 'Copy',
  inviteHint: 'Send it yourself: it works once, for this email.',
  adminAccess: 'Administrator access',
  adminAccessEntry: ({ at, reason, write }) => `Administrator access on ${new Date(at).toLocaleString('en-GB')}: ${reason}${write ? ' (with changes)' : ''}`,
  leave: 'Leave this space',
  errors: {
    'last-manager': 'A space needs at least one manager: name another one before leaving.',
    'invite-used': 'This invitation link has already been used. Ask for a new one.',
    'invite-expired': 'This invitation link has expired. Ask for a new one.',
    'not-found': 'This space does not exist, or you have no access to it.',
    role: 'Your role in this space does not allow it.',
    manage: 'Only a manager of this space can do this.',
    limit: 'This space has reached its limit.',
    member: 'This person is already a member of this space.',
  },
};

export const spacesLabelsFr: SpacesLabels = {
  choose: label => `Choisir : ${label.toLowerCase()}`,
  noSpaces: 'Aucun pour l’instant.',
  membersDescription: 'Qui peut ouvrir cet espace, et avec quel rôle.',
  members: 'Membres',
  you: ' (vous)',
  role: 'Rôle',
  remove: 'Retirer',
  invite: 'Inviter quelqu’un',
  email: 'Email',
  emailPlaceholder: 'nom@exemple.fr',
  createLink: 'Créer le lien',
  copy: 'Copier',
  inviteHint: 'Envoyez-le vous-même : il sert une fois, pour cet email.',
  adminAccess: 'Accès administrateur',
  adminAccessEntry: ({ at, reason, write }) => `Accès administrateur le ${new Date(at).toLocaleString('fr-FR')} : ${reason}${write ? ' (avec modifications)' : ''}`,
  leave: 'Quitter cet espace',
  errors: {
    'last-manager': 'Il faut au moins un responsable : nommez-en un autre avant de partir.',
    'invite-used': 'Ce lien d’invitation a déjà servi. Demandez-en un nouveau.',
    'invite-expired': 'Ce lien d’invitation a expiré. Demandez-en un nouveau.',
    'not-found': 'Cet espace n’existe pas, ou vous n’y avez pas accès.',
    role: 'Votre rôle dans cet espace ne le permet pas.',
    manage: 'Seul un responsable de cet espace peut le faire.',
    limit: 'La limite est atteinte pour cet espace.',
    member: 'Cette personne fait déjà partie de cet espace.',
  },
};

/** The words for an error of the host: by its code, else its own message. */
export const spaceErrorMessage = (error: unknown, labels: SpacesLabels = spacesLabels): string => {
  const code = (error as { code?: string } | null)?.code;
  return (code && labels.errors[code]) || (error as Error | null)?.message || String(error);
};
