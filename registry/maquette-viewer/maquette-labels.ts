/* The maquette viewer's words in English and French. `locale` picks the base set; a host's `labels` still override any of them. */

export type MaquetteLocale = 'en' | 'fr';

export const defaultMaquetteLabels = {
  /** The kind's name on the artifact card and in the panel bar. */
  kind: 'Mock-up',
  disclaimer: 'A mock-up to agree on: nothing here is built yet.',
  screenCount: (count: number) => count === 1 ? '1 screen' : `${count} screens`,
  screen: 'Screen',
  screens: 'Screens',
  previous: 'Previous',
  next: 'Next',
  position: (index: number, count: number) => `${index} / ${count}`,
  back: 'Back',
  pathTaken: 'Path taken',
  opens: (title: string) => `Opens “${title}”`,
  tours: 'Guided tours',
  tour: 'Tour',
  endTour: 'End tour',
  tourStep: (index: number, count: number) => `Step ${index} of ${count}`,
  howItWorks: 'How it works',
  cases: 'Highlight a case',
  appNavigation: 'App navigation',
  transitionBy: (by: string) => `by ${by}`,
  unknownBlock: 'Not drawn in this mock-up',
  showing: (title: string) => `Showing ${title}`,
  newerTitle: 'Made with a newer version',
  newer: (version: number) => `This mock-up uses format version ${version}. This viewer reads version 1: parts it does not know may be missing.`,
  errorTitle: 'This mock-up cannot be shown',
  invalidJson: 'The file is not valid JSON. Ask the PM to present it again.',
  invalidShape: 'The file has no screen to show (a mock-up needs "screens": { "<id>": { "title", "blocks" } }).',
};
export type MaquetteLabels = typeof defaultMaquetteLabels;

/** Typed as `MaquetteLabels`, so a key added in English must be added here too. */
export const frenchMaquetteLabels: MaquetteLabels = {
  kind: 'Maquette',
  disclaimer: 'Une maquette pour se mettre d’accord : rien n’est encore construit.',
  screenCount: count => count === 1 ? '1 écran' : `${count} écrans`,
  screen: 'Écran',
  screens: 'Écrans',
  previous: 'Précédent',
  next: 'Suivant',
  position: (index, count) => `${index} / ${count}`,
  back: 'Retour',
  pathTaken: 'Chemin parcouru',
  opens: title => `Ouvre « ${title} »`,
  tours: 'Visites guidées',
  tour: 'Visite',
  endTour: 'Terminer la visite',
  tourStep: (index, count) => `Étape ${index} sur ${count}`,
  howItWorks: 'Comment ça marche',
  cases: 'Mettre un cas en évidence',
  appNavigation: 'Navigation de l’application',
  transitionBy: by => `par ${by}`,
  unknownBlock: 'Pas dessiné dans cette maquette',
  showing: title => `Écran affiché : ${title}`,
  newerTitle: 'Faite avec une version plus récente',
  newer: version => `Cette maquette utilise la version ${version} du format. Cet afficheur lit la version 1 : ce qu’il ne connaît pas peut manquer.`,
  errorTitle: 'Cette maquette ne peut pas être affichée',
  invalidJson: 'Le fichier n’est pas du JSON valide. Demandez au PM de la présenter à nouveau.',
  invalidShape: 'Le fichier n’a aucun écran à montrer (une maquette a besoin de « screens » : { "<id>": { "title", "blocks" } }).',
};

/** The viewer's words for `locale` (English by default) with the host's overrides. */
export const maquetteLabelsFor = (locale: MaquetteLocale | undefined, labels?: Partial<MaquetteLabels>): MaquetteLabels =>
  ({ ...(locale === 'fr' ? frenchMaquetteLabels : defaultMaquetteLabels), ...labels });
