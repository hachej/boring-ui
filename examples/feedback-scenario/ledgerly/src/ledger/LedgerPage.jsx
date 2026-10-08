// Ledgerly, a fictional bookkeeping page. Header, navigation, the entry form and the exports card are marked data-feedback-visible
// (their labels and buttons may be quoted); the accounts table is a data region and stays masked; form values are always masked.
import { useState } from 'react';
import { AccountsTable } from './AccountsTable.jsx';
import { ExportButton } from './ExportButton.jsx';
import { SaveBar } from './SaveBar.jsx';
import { ACCOUNTS } from './data.js';

const NAV = ['Books', 'Accounts', 'Reports', 'Settings'];

export function LedgerPage() {
  const [saved, setSaved] = useState('');
  const [exported, setExported] = useState('');
  return <div className="ly-app" id="ledgerly-app" data-testid="ledgerly-root">
    <header className="ly-header" data-feedback-visible="">
      <span className="ly-brand"><span className="ly-logo" aria-hidden="true" />Ledgerly</span>
      <nav aria-label="Main" className="ly-nav">
        {NAV.map(name => <a key={name} href="#" aria-current={name === 'Accounts' ? 'page' : undefined} onClick={event => event.preventDefault()}>{name}</a>)}
      </nav>
    </header>
    <main className="ly-main">
      <section className="ly-intro" data-feedback-visible="">
        <h1>Accounts</h1>
        <p className="ly-lede">Record an entry, check balances and export the month.</p>
      </section>
      <form className="ly-card" data-feedback-visible="" data-testid="entry-form"
        onSubmit={event => { event.preventDefault(); setSaved('Entry saved'); }}>
        <h2>New entry</h2>
        <div className="ly-grid">
          <label className="ly-field"><span>Payee</span><input name="payee" defaultValue={ACCOUNTS[2].holder} /></label>
          <label className="ly-field"><span>Amount</span><input name="amount" inputMode="decimal" defaultValue="1,250.00" /></label>
          <label className="ly-field ly-wide"><span>Memo</span><textarea name="memo" rows={2} defaultValue={`Refund to ${ACCOUNTS[1].iban}`} /></label>
        </div>
        <SaveBar saved={saved} />
      </form>
      <AccountsTable />
      <section className="ly-card" data-feedback-visible="" data-testid="exports">
        <h2>Exports</h2>
        {['Invoices', 'Bank statements'].map(name => <div className="ly-row" key={name}>
          <span>{name}</span><ExportButton onExport={() => setExported(`${name} exported`)} />
        </div>)}
        <p className="ly-note" role="status" data-testid="exported">{exported}</p>
      </section>
    </main>
  </div>;
}
