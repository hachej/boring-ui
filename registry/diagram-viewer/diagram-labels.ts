/* The diagram viewer's words in English and French. `locale` picks the base set; a host's `labels` still override any of them. */

export type DiagramLocale = 'en' | 'fr';

export const defaultDiagramLabels = {
  /** The kind's name on the artifact card and in the panel bar. */
  kind: 'Diagram',
  transitionBy: (by: string) => `by ${by}`,
  newerTitle: 'Made with a newer version',
  newer: (version: number) => `This diagram uses format version ${version}. This viewer reads version 1: parts it does not know may be missing.`,
  errorTitle: 'This diagram cannot be shown',
  invalidJson: 'The file is not valid JSON. Ask the agent to present it again.',
  invalidShape: 'The file has no node to draw (a diagram needs "nodes": [{ "id", "label" }]).',
};
export type DiagramLabels = typeof defaultDiagramLabels;

/** Typed as `DiagramLabels`, so a key added in English must be added here too. */
export const frenchDiagramLabels: DiagramLabels = {
  kind: 'Diagramme',
  transitionBy: by => `par ${by}`,
  newerTitle: 'Fait avec une version plus récente',
  newer: version => `Ce diagramme utilise la version ${version} du format. Cet afficheur lit la version 1 : ce qu’il ne connaît pas peut manquer.`,
  errorTitle: 'Ce diagramme ne peut pas être affiché',
  invalidJson: 'Le fichier n’est pas du JSON valide. Demandez à l’agent de le présenter à nouveau.',
  invalidShape: 'Le fichier n’a aucun nœud à dessiner (un diagramme a besoin de « nodes » : [{ "id", "label" }]).',
};

/** The viewer's words for `locale` (English by default) with the host's overrides. */
export const diagramLabelsFor = (locale: DiagramLocale | undefined, labels?: Partial<DiagramLabels>): DiagramLabels =>
  ({ ...(locale === 'fr' ? frenchDiagramLabels : defaultDiagramLabels), ...labels });
