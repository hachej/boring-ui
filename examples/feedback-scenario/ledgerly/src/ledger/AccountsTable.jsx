// A data region left unmarked (no data-feedback-visible): its text and attributes are masked in every label and report.
import { ACCOUNTS } from './data.js';

export function AccountsTable() {
  return <section className="ly-card" data-testid="accounts">
    <table className="ly-table" aria-label={`Accounts of ${ACCOUNTS[0].holder}`}>
      <thead><tr><th>Holder</th><th>IBAN</th><th>Balance</th></tr></thead>
      <tbody>
        {ACCOUNTS.map(account => <tr key={account.iban} data-customer={account.holder} title={account.iban}>
          <td><a href={`/customers/${encodeURIComponent(account.holder)}?iban=${encodeURIComponent(account.iban)}`} onClick={event => event.preventDefault()}>{account.holder}</a></td>
          <td className="ly-mono">{account.iban}</td>
          <td className="ly-num">{account.balance}</td>
        </tr>)}
      </tbody>
    </table>
  </section>;
}
