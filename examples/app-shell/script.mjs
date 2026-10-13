// The scripted model's side of the app-shell journey (format: ../studio/scripted-model.mjs): what the model answers to each prompt, so the
// journey runs the same way every time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
export const SOURCES = [{ name: 'app-shell', entries: Object.entries({
  'message 1': ['Réponse un : tu as marché 8 200 pas hier.'],
  'message 2': ['Réponse deux : la moyenne de la semaine est de 7 400 pas.'],
  'message 3': ['Réponse trois : essaie une marche de vingt minutes après le déjeuner.'],
  'message 4': ['Réponse quatre : ton meilleur jour reste mardi, avec 10 300 pas.'],
  'message 5': ['Réponse cinq : on garde le même objectif pour la semaine prochaine.'],
  'Combien de pas hier': ['Hier : 8 200 pas, soit 94 % de ton objectif.'],
  'Dis-moi ce qui manque': ['Il manque un graphique de la semaine sur l\'écran Progrès.'],
}).map(([match, turns]) => ({ match, turns })) }];
