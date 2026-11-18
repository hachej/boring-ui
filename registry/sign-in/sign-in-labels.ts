/** The words of the sign-in pages, in the kit's two languages; an app overrides any of them through `labels`. */
export interface SignInLabels {
  readonly signInTitle: string;
  readonly signUpTitle: string;
  readonly signInLead: (app: string) => string;
  readonly signUpLead: (app: string) => string;
  readonly firstOwnerLead: (app: string) => string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly signIn: string;
  readonly signUp: string;
  readonly working: string;
  readonly toSignUp: string;
  readonly toSignIn: string;
  readonly google: string;
  readonly or: string;
  readonly failed: string;
  readonly studioRefused: string;
  readonly consentTitle: string;
  readonly consentText: (app: string) => string;
  readonly allow: string;
  readonly deny: string;
  readonly consentFailed: string;
  readonly peopleTitle: string;
  readonly peopleLead: string;
  readonly invite: string;
  readonly asOwner: string;
  readonly asMember: string;
  readonly remove: string;
  readonly owner: string;
  readonly member: string;
  readonly nobody: string;
  readonly studio: string;
  readonly studioLead: string;
  readonly openStudio: string;
  readonly signOut: string;
}

export const signInLabels: Record<'fr' | 'en', SignInLabels> = {
  en: {
    signInTitle: 'Sign in', signUpTitle: 'Create your account',
    signInLead: app => `Sign in to ${app}.`, signUpLead: app => `${app} is by invitation: use the address you were invited with.`,
    firstOwnerLead: app => `You are setting up ${app}: the account you create now is its owner.`,
    name: 'Name', email: 'E-mail', password: 'Password', signIn: 'Sign in', signUp: 'Create my account', working: 'One moment…',
    toSignUp: 'Invited? Create your account', toSignIn: 'Already have an account? Sign in', google: 'Continue with Google', or: 'or',
    failed: 'That did not work. Try again.', studioRefused: 'Studio could not confirm you own this app.',
    consentTitle: 'Allow your assistant?', consentText: app => `Your assistant asks to use ${app} as you: read and change what you can. You can remove it later.`,
    allow: 'Allow', deny: 'Deny', consentFailed: 'The answer did not go through. Try again.',
    peopleTitle: 'People', peopleLead: 'Only the addresses on this list can create an account.', invite: 'Invite',
    asOwner: 'as owner', asMember: 'as member', remove: 'Remove', owner: 'Owner', member: 'Member', nobody: 'Nobody is invited yet.',
    studio: 'Studio', studioLead: 'This app\'s page in Studio: its cards, its builds and its people.', openStudio: 'Open in Studio', signOut: 'Sign out',
  },
  fr: {
    signInTitle: 'Connexion', signUpTitle: 'Créer votre compte',
    signInLead: app => `Connectez-vous à ${app}.`, signUpLead: app => `${app} est sur invitation : utilisez l’adresse avec laquelle vous avez été invité.`,
    firstOwnerLead: app => `Vous installez ${app} : le compte que vous créez maintenant en est le propriétaire.`,
    name: 'Nom', email: 'E-mail', password: 'Mot de passe', signIn: 'Se connecter', signUp: 'Créer mon compte', working: 'Un instant…',
    toSignUp: 'Invité ? Créez votre compte', toSignIn: 'Déjà un compte ? Connectez-vous', google: 'Continuer avec Google', or: 'ou',
    failed: 'Ça n’a pas marché. Réessayez.', studioRefused: 'Studio n’a pas pu confirmer que vous êtes propriétaire de cette app.',
    consentTitle: 'Autoriser votre assistant ?', consentText: app => `Votre assistant demande à utiliser ${app} en votre nom : lire et modifier ce que vous pouvez. Vous pourrez le retirer.`,
    allow: 'Autoriser', deny: 'Refuser', consentFailed: 'La réponse n’est pas passée. Réessayez.',
    peopleTitle: 'Personnes', peopleLead: 'Seules les adresses de cette liste peuvent créer un compte.', invite: 'Inviter',
    asOwner: 'propriétaire', asMember: 'membre', remove: 'Retirer', owner: 'Propriétaire', member: 'Membre', nobody: 'Personne n’est encore invité.',
    studio: 'Studio', studioLead: 'La page de cette app dans Studio : ses cartes, ses versions et ses personnes.', openStudio: 'Ouvrir dans Studio', signOut: 'Se déconnecter',
  },
};
