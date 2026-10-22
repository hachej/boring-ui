// Fictional documents shared by the public editor tests and viewer-chrome journey.
export const preservedMarkdown = '---\ntitle: Cedar Works\nstatus: fictional\n---\n\nA fictional paragraph.\n\n<!-- Fictional editorial note -->\n\n<details>\n<summary>Packing list</summary>\nBring a blanket.\n</details>\n\nA note[^picnic] and a [reference][cedar], with <br> inline HTML.\n\n[^picnic]: A fictional footnote.\n\n[cedar]: https://fictional.invalid/ "Cedar"\n\n* Bring tea\n    * Pack cups\n';
export const markdownRichCorpus = [
  ['README with badges and details', 'A fictional paragraph.\n\n[![build](https://fictional.invalid/badge.svg)](https://fictional.invalid/)\n\n<details>\n<summary>Fictional setup</summary>\nRun the picnic.\n</details>\n'],
  ['front matter and HTML', preservedMarkdown],
  ['CRLF', 'A fictional paragraph.\r\n\r\n# Cedar\r\n\r\n* Bring tea\r\n'],
  ['footnotes', 'A fictional paragraph.\n\nA note[^one].\n\n[^one]: Fictional note.\n    Continued note.\n'],
  ['references', 'A fictional paragraph.\n\n[full][cedar], [cedar][], and [cedar].\n\n[cedar]: https://fictional.invalid/ "Site"\n'],
  ['style variants', 'A fictional paragraph.\n\nCedar Works\n===========\n\n* First _italic_ and __bold__\n    * Nested\n\n***\n'],
];
