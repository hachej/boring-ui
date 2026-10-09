import { Marked, marked } from 'marked';

/** Tiptap expects the callable marked API; keep its mutable options local to one editor. */
export function createMarkdownParser(): typeof marked {
  const instance = new Marked({ tokenizer: { html: () => undefined, tag: () => undefined } });
  // marked HTML-escapes the text of inline tokens (`&` becomes `&amp;`); the editor holds plain text, so decode it again or a
  // serialised document would not match what was written.
  const plain = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity] ?? entity);
  const decode = (tokens: ReturnType<typeof marked.lexer>) => {
    marked.walkTokens(tokens, token => {
      if ((token.type === 'text' || token.type === 'escape' || token.type === 'codespan') && !('tokens' in token && token.tokens)) token.text = plain(token.text);
    });
    return tokens;
  };
  const parser = Object.assign(instance.parse, marked);
  parser.parse = parser;
  parser.defaults = instance.defaults;
  parser.lexer = (source, options) => decode(options ? marked.Lexer.lex(source, options) : marked.Lexer.lex(source, instance.defaults));
  parser.parseInline = instance.parseInline;
  parser.walkTokens = instance.walkTokens.bind(instance);
  parser.use = (...extensions) => {
    instance.use(...extensions);
    parser.defaults = instance.defaults;
    return parser;
  };
  parser.setOptions = options => {
    instance.setOptions(options);
    parser.defaults = instance.defaults;
    return parser;
  };
  parser.options = parser.setOptions;
  return parser;
}
