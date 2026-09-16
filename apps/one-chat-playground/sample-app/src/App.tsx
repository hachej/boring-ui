const clients = [
  { id: 1, name: 'Ava Martin', company: 'Northwind Studio', status: 'Active', value: '€12,400' },
  { id: 2, name: 'Léo Bernard', company: 'Bernard & Fils', status: 'Pending', value: '€3,200' },
  { id: 3, name: 'Sofia Rossi', company: 'Rossi Design', status: 'Active', value: '€8,950' },
]

export function App() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Clients</h1>
        <p>Everyone you are working with right now.</p>
      </header>
      <table className="clients">
        <thead>
          <tr>
            <th>Name</th>
            <th>Company</th>
            <th>Status</th>
            <th className="num">Value</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td className="name">{client.name}</td>
              <td>{client.company}</td>
              <td>
                <span className={`status status-${client.status.toLowerCase()}`}>{client.status}</span>
              </td>
              <td className="num">{client.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
