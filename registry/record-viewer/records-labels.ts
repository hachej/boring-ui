export type RecordsLocale = 'en' | 'fr';

export const defaultRecordsLabels = {
  kind: 'Records',
  actions: 'Actions',
  empty: 'No records',
  missing: '—',
  invalidTitle: 'This file cannot be shown as records',
  invalidNote: 'Invalid records@1 data. The original raw text is shown below.',
};
export type RecordsLabels = typeof defaultRecordsLabels;
export const frenchRecordsLabels: RecordsLabels = {
  kind: 'Données',
  actions: 'Actions',
  empty: 'Aucune donnée',
  missing: '—',
  invalidTitle: 'Ce fichier ne peut pas être affiché en tableau',
  invalidNote: 'Données records@1 invalides. Le texte brut original est affiché ci-dessous.',
};
export const recordsLabelsFor = (locale: RecordsLocale | undefined, labels?: Partial<RecordsLabels>): RecordsLabels =>
  ({ ...(locale === 'fr' ? frenchRecordsLabels : defaultRecordsLabels), ...labels });
