// 20 fictional bank statements as text, for the real check of the native structured output (scripts/cap-real/llm-native.mjs). Built
// deterministically from invented lines (Banque Exemple, Société Fictive); each knows its opening and closing balance, so a reading can be
// checked: opening + the movements read = closing.
const LINES = [
  ['Loyer bureau', -95000], ['Virement client Exemple SARL', 240000], ['Prélèvement assurance Fictive', -31200], ['Frais de tenue de compte', -900],
  ['Carte Boulangerie Exemple', -1580], ['Virement client Cabinet Fictif', 180000], ['Prélèvement téléphone Orange-Exemple', -1999],
  ['Commission carte bancaire', -320], ['Achat fournitures Imprimerie Test', -9600], ['Remise de chèques', 45000], ['Péage autoroute A7', -1830],
];
const euros = (cents) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${String(Math.abs(cents) % 100).padStart(2, '0')}`;

export const STATEMENTS = Object.freeze(Array.from({ length: 20 }, (_, i) => {
  const month = String((i % 12) + 1).padStart(2, '0'), year = 2026 - Math.floor(i / 12), opening = 500_000 + i * 12_345;
  const moves = LINES.filter((_, j) => (i + j) % 3 !== 0).map(([label, cents], j) => ({ day: String(2 + j * 2).padStart(2, '0'), label, cents: cents + Math.sign(cents) * i * 7 }));
  const closing = moves.reduce((sum, m) => sum + m.cents, opening);
  const text = [
    'Banque Exemple - Relevé de compte', `Titulaire : Société Fictive ${i + 1}`, `IBAN : FR76 0000 0000 0000 0000 0000 ${String(i + 1).padStart(3, '0')}`, `Période : ${month}/${year}`,
    `Solde initial au 01/${month}/${year} : ${euros(opening)} EUR`, '', 'Date | Libellé | Débit | Crédit',
    ...moves.map((m) => `${m.day}/${month} | ${m.label} | ${m.cents < 0 ? euros(-m.cents) : ''} | ${m.cents > 0 ? euros(m.cents) : ''}`),
    '', `Solde final au 28/${month}/${year} : ${euros(closing)} EUR`,
  ].join('\n');
  return Object.freeze({ text, opening, closing, movements: moves.length });
}));
