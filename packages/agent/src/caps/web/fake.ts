// The fake provider: nothing leaves, the same query gives the same two fictional results, any https page reads as a short page about its host,
// and a path holding "big" reads as a page over the cap.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'query';

export const fakeSearch = ({ query, limit }: { query: string; limit: number }) => ({
  results: [
    { title: `Fictional result about ${query}`, url: `https://fiction.example.test/${slug(query)}`, snippet: `A fictional page that discusses ${query}.`, published: '2026-01-15' },
    { title: `Another fictional take on ${query}`, url: `https://notes.example.test/${slug(query)}/2`, snippet: 'Another fictional snippet.', published: null },
  ].slice(0, limit),
});
export const fakeFetch = ({ url }: { url: string }) => {
  const { hostname, pathname } = new URL(url);
  const body = pathname.includes('big') ? 'A fictional sentence that repeats. '.repeat(1000) : `A fictional page served by ${hostname}.`;
  return { url, title: `Fictional page of ${hostname}`, markdown: `# Fictional page of ${hostname}\n\n${body}`, truncated: false };
};
