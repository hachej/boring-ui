// Named corpus `app-dom-mutations@1` for `app.element@1`. Fictional pages only. Each step is a full page; `build.mjs` serializes
// every page through the WP3 policy into an `app.dom@1` snapshot, so steps carry full snapshots as the kit requires.
// Markers are ordinary `data-*` attributes the policy drops, so they never reach a snapshot:
//   data-pick              the element picked on the capture page;
//   data-expect="target"   the one element an `exact`/`moved` step must land on;
//   data-expect="candidate" each element an `ambiguous` step must offer (the complete set).
// Ground truth: an identity (`data-feedback-id`, or a `data-testid` unique on the page) is the application's declaration of which
// element it is. Without one, the expected candidates are every element of the same tag whose kept signals (role, readable name,
// source, identities) do not contradict the anchor: page structure never decides alone.

export const CORPUS_NAME = 'app-dom-mutations@1';

const shell = main => `<header><nav><a>Home</a><a>Settings</a></nav></header><main>${main}</main><footer><p>Fictional Co</p></footer>`;
const bar = (button, extra = '') => shell(`<form><div><label>Display name</label><input type="text"></div><div>${extra}${button}</div></form>`);

export const appCorpus = [
  {
    name: 'save button with a feedback id',
    group: 'identity',
    capture: bar('<button type="button" data-feedback-id="save-settings" data-pick>Save</button>'),
    steps: [
      { name: 'unchanged', page: bar('<button type="button" data-feedback-id="save-settings" data-expect="target">Save</button>'), expect: 'exact' },
      { name: 'wrapper inserted around the button', page: bar('<span><button type="button" data-feedback-id="save-settings" data-expect="target">Save</button></span>'), expect: 'moved' },
      { name: 'sibling button added before it', page: bar('<button type="button" data-feedback-id="save-settings" data-expect="target">Save</button>', '<button type="button">Reset</button>'), expect: 'moved' },
      { name: 'masked text changed', page: bar('<button type="button" data-feedback-id="save-settings" data-expect="target">Save all changes</button>'), expect: 'exact' },
      { name: 'id duplicated on a second button', page: bar('<button type="button" data-feedback-id="save-settings" data-expect="candidate">Save</button><button type="button" data-feedback-id="save-settings" data-expect="candidate">Save</button>'), expect: 'ambiguous' },
      { name: 'id removed', page: bar('<button type="button" data-expect="candidate">Save</button>', '<button type="button" data-expect="candidate">Reset</button>'), expect: 'ambiguous' },
      { name: 'id removed and the form emptied', page: shell('<form><p>Nothing to save</p></form>'), expect: 'missing' },
    ],
  },
  {
    name: 'wrapper removed after capture',
    group: 'identity',
    capture: bar('<span><button type="button" data-feedback-id="save-settings" data-pick>Save</button></span>'),
    steps: [
      { name: 'wrapper removed', page: bar('<button type="button" data-feedback-id="save-settings" data-expect="target">Save</button>'), expect: 'moved' },
      { name: 'whole form wrapped in a section', page: shell('<section><form><div><label>Display name</label><input type="text"></div><div><span><button type="button" data-feedback-id="save-settings" data-expect="target">Save</button></span></div></form></section>'), expect: 'moved' },
    ],
  },
  {
    name: 'export button with a unique test id',
    group: 'identity',
    capture: shell('<div><button data-testid="export-csv" data-pick>Export</button><button data-testid="import-csv">Import</button></div>'),
    steps: [
      { name: 'unchanged', page: shell('<div><button data-testid="export-csv" data-expect="target">Export</button><button data-testid="import-csv">Import</button></div>'), expect: 'exact' },
      { name: 'buttons swapped', page: shell('<div><button data-testid="import-csv">Import</button><button data-testid="export-csv" data-expect="target">Export</button></div>'), expect: 'moved' },
      { name: 'test id now also on a link', page: shell('<div><button data-testid="export-csv" data-expect="candidate">Export</button><a data-testid="export-csv">Export</a></div>'), expect: 'ambiguous' },
      { name: 'test id removed', page: shell('<div><button data-expect="candidate">Export</button><button data-testid="import-csv">Import</button></div>'), expect: 'ambiguous' },
      { name: 'test id removed and added to another button', page: shell('<div><button>Export</button><button data-testid="import-csv">Import</button></div><aside><button data-testid="export-csv" data-expect="target">Export</button></aside>'), expect: 'moved' },
      { name: 'feedback id added to it', page: shell('<div><button data-testid="export-csv" data-feedback-id="export" data-expect="target">Export</button><button data-testid="import-csv">Import</button></div>'), expect: 'exact' },
    ],
  },
  {
    name: 'button with both a feedback id and a test id',
    group: 'identity',
    capture: shell('<div><button data-feedback-id="export" data-testid="export-csv" data-pick>Export</button></div>'),
    steps: [
      { name: 'feedback id removed: the unique test id places it', page: shell('<div><span><button data-testid="export-csv" data-expect="target">Export</button></span></div>'), expect: 'moved' },
      { name: 'test id now on an element with another feedback id', page: shell('<div><button data-feedback-id="import" data-testid="export-csv">Export</button></div>'), expect: 'missing' },
      { name: 'test id changed, feedback id kept', page: shell('<div><button data-feedback-id="export" data-testid="export-xlsx" data-expect="target">Export</button></div>'), expect: 'exact' },
    ],
  },
  {
    name: 'test id shared by every row at capture',
    group: 'duplicate',
    capture: shell('<ul><li><button data-testid="row-delete">Delete</button></li><li><button data-testid="row-delete" data-pick>Delete</button></li><li><button data-testid="row-delete">Delete</button></li></ul>'),
    steps: [
      { name: 'unchanged', page: shell('<ul><li><button data-testid="row-delete" data-expect="candidate">Delete</button></li><li><button data-testid="row-delete" data-expect="candidate">Delete</button></li><li><button data-testid="row-delete" data-expect="candidate">Delete</button></li></ul>'), expect: 'ambiguous' },
      { name: 'only one row left: still not an identity', page: shell('<ul><li><button data-testid="row-delete" data-expect="candidate">Delete</button></li></ul>'), expect: 'ambiguous' },
    ],
  },
  {
    name: 'reordered identical rows without ids',
    group: 'reorder',
    capture: shell('<ul><li><span>Ada</span><button>Remove</button></li><li><span>Grace</span><button data-pick>Remove</button></li><li><span>Linus</span><button>Remove</button></li></ul>'),
    steps: [
      { name: 'rows reordered', page: shell('<ul><li><span>Grace</span><button data-expect="candidate">Remove</button></li><li><span>Linus</span><button data-expect="candidate">Remove</button></li><li><span>Ada</span><button data-expect="candidate">Remove</button></li></ul>'), expect: 'ambiguous' },
      { name: 'one row removed', page: shell('<ul><li><span>Ada</span><button data-expect="candidate">Remove</button></li><li><span>Linus</span><button data-expect="candidate">Remove</button></li></ul>'), expect: 'ambiguous' },
    ],
  },
  {
    name: 'reordered rows with per-row feedback ids',
    group: 'reorder',
    capture: shell('<ul><li><button data-feedback-id="remove-ada">Remove</button></li><li><button data-feedback-id="remove-grace" data-pick>Remove</button></li><li><button data-feedback-id="remove-linus">Remove</button></li></ul>'),
    steps: [
      { name: 'rows reordered', page: shell('<ul><li><button data-feedback-id="remove-linus">Remove</button></li><li><button data-feedback-id="remove-ada">Remove</button></li><li><button data-feedback-id="remove-grace" data-expect="target">Remove</button></li></ul>'), expect: 'moved' },
      { name: 'its row removed', page: shell('<ul><li><button data-feedback-id="remove-ada">Remove</button></li><li><button data-feedback-id="remove-linus">Remove</button></li></ul>'), expect: 'missing' },
      { name: 'its row removed and an id-less row added', page: shell('<ul><li><button data-feedback-id="remove-ada">Remove</button></li><li><button data-expect="candidate">Remove</button></li><li><button data-feedback-id="remove-linus">Remove</button></li></ul>'), expect: 'ambiguous' },
    ],
  },
  {
    name: 'duplicated buttons',
    group: 'duplicate',
    capture: shell('<section><button type="button">Add</button></section><section><button type="button" data-pick>Add</button></section>'),
    steps: [
      { name: 'unchanged: structure alone never decides', page: shell('<section><button type="button" data-expect="candidate">Add</button></section><section><button type="button" data-expect="candidate">Add</button></section>'), expect: 'ambiguous' },
      { name: 'a third copy added', page: shell('<section><button type="button" data-expect="candidate">Add</button></section><section><button type="button" data-expect="candidate">Add</button><button type="button" data-expect="candidate">Add</button></section>'), expect: 'ambiguous' },
      { name: 'one became a submit button', page: shell('<section><button type="button" data-expect="candidate">Add</button></section><section><button type="submit" data-expect="candidate">Add</button></section>'), expect: 'ambiguous' },
    ],
  },
  {
    name: 'list rows sharing one data-source',
    group: 'source',
    capture: shell('<ul><li data-source="src/MemberList.tsx:12">Ada</li><li data-source="src/MemberList.tsx:12" data-pick>Grace</li><li data-source="src/MemberList.tsx:12">Linus</li><li data-source="src/Footer.tsx:4">More</li></ul>'),
    steps: [
      { name: 'unchanged', page: shell('<ul><li data-source="src/MemberList.tsx:12" data-expect="candidate">Ada</li><li data-source="src/MemberList.tsx:12" data-expect="candidate">Grace</li><li data-source="src/MemberList.tsx:12" data-expect="candidate">Linus</li><li data-source="src/Footer.tsx:4">More</li></ul>'), expect: 'ambiguous' },
      { name: 'a row removed', page: shell('<ul><li data-source="src/MemberList.tsx:12" data-expect="candidate">Ada</li><li data-source="src/MemberList.tsx:12" data-expect="candidate">Linus</li><li data-source="src/Footer.tsx:4">More</li></ul>'), expect: 'ambiguous' },
      { name: 'source stamps gone (production build)', page: shell('<ul><li data-expect="candidate">Ada</li><li data-expect="candidate">Grace</li><li data-expect="candidate">Linus</li><li data-expect="candidate">More</li></ul>'), expect: 'ambiguous' },
      { name: 'only other sources remain', page: shell('<ul><li data-source="src/Footer.tsx:4">More</li></ul>'), expect: 'missing' },
    ],
  },
  {
    name: 'element replaced by a look-alike',
    group: 'look-alike',
    capture: shell('<div><button data-feedback-id="publish" data-pick>Publish</button></div>'),
    steps: [
      { name: 'same text, no id', page: shell('<div><button data-expect="candidate">Publish</button></div>'), expect: 'ambiguous' },
      { name: 'same id on a link', page: shell('<div><a data-feedback-id="publish">Publish</a></div>'), expect: 'missing' },
      { name: 'look-alike with another id', page: shell('<div><button data-feedback-id="publish-draft">Publish</button></div>'), expect: 'missing' },
      { name: 'look-alike with another role', page: shell('<div><button role="tab">Publish</button></div>'), expect: 'missing' },
    ],
  },
  {
    name: 'text inside a visible region',
    group: 'text',
    capture: shell('<div data-feedback-visible><button>Save</button><button data-pick>Cancel</button></div>'),
    steps: [
      { name: 'unchanged: the readable name rules out Save', page: shell('<div data-feedback-visible><button>Save</button><button data-expect="candidate">Cancel</button></div>'), expect: 'ambiguous' },
      { name: 'buttons swapped', page: shell('<div data-feedback-visible><button data-expect="candidate">Cancel</button><button>Save</button></div>'), expect: 'ambiguous' },
      { name: 'its text changed', page: shell('<div data-feedback-visible><button>Save</button><button>Discard</button></div>'), expect: 'missing' },
      { name: 'region no longer visible: names unknown', page: shell('<div><button data-expect="candidate">Save</button><button data-expect="candidate">Cancel</button></div>'), expect: 'ambiguous' },
    ],
  },
  {
    name: 'text outside visible regions',
    group: 'text',
    capture: shell('<div><button>Save</button><button data-pick>Cancel</button></div>'),
    steps: [
      { name: 'masked text changed length', page: shell('<div><button data-expect="candidate">Save now</button><button data-expect="candidate">Never mind</button></div>'), expect: 'ambiguous' },
      { name: 'region made visible', page: shell('<div data-feedback-visible><button data-expect="candidate">Save</button><button data-expect="candidate">Cancel</button></div>'), expect: 'ambiguous' },
    ],
  },
  {
    name: 'truncated snapshot',
    group: 'truncated',
    capture: bar('<button type="button" data-feedback-id="save-settings" data-pick>Save</button>'),
    steps: [
      { name: 'identity inside the serialized prefix', page: bar('<button type="button" data-feedback-id="save-settings" data-expect="candidate">Save</button>'), limits: { maxNodes: 12 }, expect: 'ambiguous' },
      { name: 'identity cut by truncation', page: bar('<button type="button" data-feedback-id="save-settings">Save</button>'), limits: { maxNodes: 8 }, expect: 'missing' },
    ],
  },
  {
    name: 'uninstalled future version',
    group: 'unknown-kind',
    anchor: { kind: 'app.element@2', signals: { feedbackId: 'save-settings' }, fallback: 'the «Save» button' },
    capture: bar('<button type="button" data-feedback-id="save-settings">Save</button>'),
    steps: [
      { name: 'placed as unsupported', page: bar('<button type="button" data-feedback-id="save-settings">Save</button>'), expect: 'unsupported' },
    ],
  },
];
