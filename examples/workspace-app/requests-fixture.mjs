// Fictional host projections only. D-901–D-912 belong to Atelier Exemple.
export const requestViews = Array.from({ length: 12 }, (_, index) => {
  const number = `D-${901 + index}`;
  const state = ['question', 'question', 'building', 'try', 'checking', 'validation', 'building', 'try', 'live', 'live', 'abandoned', 'building'][index];
  return { number, title: ['Le devis', 'Valider le devis', 'Le catalogue', 'La page atelier', 'Vérifier le devis', 'La livraison', 'Les horaires', 'Le formulaire', 'Les contacts', 'La vitrine', 'Ancienne piste', 'La recherche'][index],
    state, line: `Atelier Exemple · ${number}`, since: `2026-10-${String(index + 1).padStart(2, '0')}T09:00:00Z`, repo: index < 8 ? 'Atelier Exemple' : 'Atelier Exemple — vitrine', master: 'main',
    ...(index === 0 ? { question: { kind: 'answer', text: 'Que faut-il afficher sur le devis ?' } } : index === 1 ? { question: { kind: 'approval', text: 'Ce devis vous convient-il ?' } } : index === 5 ? { question: { kind: 'release', text: 'Mettre cette version en ligne ?' } } : {}),
    ...(state === 'try' ? { action: { kind: index === 3 ? 'preview' : 'pr', href: 'https://atelier-exemple.invalid/preview' } } : {}),
    ...(index === 4 ? { waitsOn: 'la vérification' } : {}),
    links: index === 4 ? [{ kind: 'parent', number: 'D-904' }, { kind: 'child', number: 'D-912' }, { kind: 'blocked_by', number: 'D-901' }] : [],
    history: [{ at: '2026-10-01T08:00:00Z', text: `${number} créée` }, { at: '2026-10-02T09:00:00Z', text: `${number} mise en vérification` }],
  };
});
// The release approval is independent from the two questions in the initial inbox fixture.
export const inboxViews = requestViews.map(view => view.number === 'D-906' ? { ...view, question: undefined } : view);
