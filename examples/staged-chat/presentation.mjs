/** Host projection: retain every native event, but update each task's first display marker in place. */
export function stageProjection(entries) {
  const tasks = new Map(), errors = new Map();
  let failedStage;
  for (const entry of entries) {
    if (entry.model?.some(message => message.role === 'user')) failedStage = undefined;
    if (entry.kind === 'fictional.triage.stage') {
      const earlier = tasks.get(entry.data.taskId);
      tasks.set(entry.data.taskId, { ...entry.data, entryId: earlier?.entryId ?? entry.id });
      if (entry.data.state === 'failed') failedStage = entry.data.stage;
    }
    if (failedStage !== undefined && entry.model?.some(message => message.role === 'assistant' && message.stopReason === 'error')) errors.set(String(entry.id), failedStage);
  }
  return { cards: new Map([...tasks.values()].map(task => [task.entryId, task])), errors };
}

export function demoLabels(locale) {
  const french = locale === 'fr', plural = new Intl.PluralRules(locale), number = new Intl.NumberFormat(locale);
  const seconds = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 });
  const milliseconds = new Intl.NumberFormat(locale, { style: 'unit', unit: 'millisecond', unitDisplay: 'short', maximumFractionDigits: 0 });
  return {
    offers: count => `${number.format(count)} ${french ? plural.select(count) === 'one' ? 'offre utilisée' : 'offres utilisées' : plural.select(count) === 'one' ? 'offer used' : 'offers used'}`,
    duration: durationMs => typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? `${french ? 'Durée : ' : 'Duration: '}${durationMs < 1000 ? milliseconds.format(durationMs) : seconds.format(durationMs / 1000)}` : undefined,
    stage: (stage, state) => french ? `Étape ${stage} : ${{ running: 'en cours', validated: 'validée', failed: 'échec' }[state]}` : `Stage ${stage}: ${{ running: 'in progress', validated: 'validated', failed: 'failed' }[state]}`,
    preparing: stage => french ? `Validation de l’étape ${stage}…` : `Validating stage ${stage}…`,
    failure: stage => stage === 1 ? french ? 'La création de la note a échoué. Votre question a été remise dans le champ de saisie.' : 'The note could not be created. Your question has been restored in the composer.' : french ? `L’étape ${stage} a échoué. La note précédente reste disponible.` : `Stage ${stage} failed. The earlier note remains available.`,
    failButton: stage => french ? `Échec étape ${stage}` : `Fail stage ${stage}`,
    offer: french ? 'Utiliser cette note fictive' : 'Use this fictional note',
    markSeen: french ? 'Marquer cette réponse comme lue' : 'Mark this reply as read',
    unread: french ? 'Non lu' : 'Unread',
  };
}
