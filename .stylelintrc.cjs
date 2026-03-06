module.exports = {
  ignoreFiles: [
    'src/front/styles/tokens.css',
    'src/front/providers/companion/upstream.css',
    'src/front/providers/companion/upstream/**/*.css',
  ],
  rules: {
    'color-no-hex': true,
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
  },
}
