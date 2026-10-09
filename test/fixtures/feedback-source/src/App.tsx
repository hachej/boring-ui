// Fictional fixture for test/packages/feedback-source.test.mjs: a tiny reading-list page.
import { SaveBar } from './SaveBar';

const books = ['Field notes', 'Garden almanac', 'Harbour charts'];

export function App() {
  return (
    <main className="reading-list">
      <h1>Reading list</h1>
      <ul>
        {books.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
      <p data-source="explicit/Note.tsx:7">Explicit location</p>
      <SaveBar label="Save list" />
    </main>
  );
}
