'use client';

import { TextDraftControls } from './text-draft-controls.js';

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { SelectionBookmark } from '@tiptap/pm/state';
import type { MarkdownController } from './markdown.js';
import { createMarkdownExtensions, type MarkdownImageResolver } from './markdown-extensions.js';
import { checkMarkdownRichSafety, describeUnsafe, finishRichMarkdown, type MarkdownRichSafety } from './markdown-safety.js';
import { MarkdownIcon, type MarkdownIconName } from './markdown-icons.js';
import { MarkdownProposalDiff } from './markdown-proposal-diff.js';
import { createMountedMarkdownTools, type MarkdownMountedTools } from './markdown-mounted.js';
export { checkMarkdownRichSafety } from './markdown-safety.js';
export type { MarkdownRichSafety } from './markdown-safety.js';
export type { MarkdownImageResolver } from './markdown-extensions.js';
export type { MarkdownMountedTools, MarkdownMountedSubject, MarkdownMountedSelection, MarkdownMountedInspection } from './markdown-mounted.js';

export interface MarkdownEditorProps {
  readonly controller: MarkdownController;
  readonly title?: string;
  readonly initialMode?: 'rich' | 'source';
  readonly placeholder?: string;
  readonly className?: string;
  readonly onMountedTools?: (tools: MarkdownMountedTools | null) => void;
  /** `false` omits the built-in header (title, status, source toggle, Save) so a host bar such as the viewer frame supplies them. */
  readonly header?: boolean;
  /** Controlled mode. The editor still falls back to `source` for a document that rich editing cannot keep exactly. */
  readonly mode?: 'rich' | 'source';
  readonly onModeChange?: (mode: 'rich' | 'source') => void;
  /** Reports whether the loaded document can be edited in rich mode without losing anything. */
  readonly onRichSafety?: (safety: MarkdownRichSafety) => void;
  /** Images never load unless this maps their address to a URL (inline `data:` images load without it). */
  readonly resolveImage?: MarkdownImageResolver;
}

/** Borrows the controller. The host owns document selection, access and disposal. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const active = useRef(props.controller);
  active.current = props.controller;
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  return <MarkdownEditorSession key={mount.sequence} {...props} activeController={active} />;
}

function MarkdownEditorSession({ controller, title = 'Document', initialMode = 'rich', placeholder = 'Start writing', className, onMountedTools, header = true, mode: controlledMode, onModeChange, onRichSafety, resolveImage, activeController: active }: MarkdownEditorProps & { readonly activeController: { readonly current: MarkdownController } }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const projected = useRef<string | null>(null);
  const emitted = useRef<string | null>(null);
  const [ownMode, setOwnMode] = useState(initialMode);
  const requestedMode = controlledMode ?? ownMode;
  // Rich editing is only offered for a document the editor can keep exactly; anything else is edited as source.
  const checked = useDeferredValue(state.text);
  // The editor's own output is safe by construction; only text that arrived from elsewhere (or from the source box) is checked.
  const ownText = state.text === emitted.current;
  const safety = useMemo<MarkdownRichSafety>(() => ownText ? { safe: true } : checkMarkdownRichSafety(checked), [checked, ownText]);
  const richOffered = safety.safe;
  const mode = richOffered ? requestedMode : 'source';
  const activeMode = useRef(mode); activeMode.current = mode;
  const images = useRef(resolveImage); images.current = resolveImage;
  useEffect(() => { onRichSafety?.(safety); }, [safety, onRichSafety]);
  const [error, setError] = useState<string | null>(null);
  const interaction = useRef(false);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const richBookmark = useRef<{ version: number; selection: SelectionBookmark } | null>(null);
  const sourceBookmark = useRef<{ version: number; start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null>(null);
  const focusAfterSwitch = useRef(false);
  const markInteraction = () => {
    interaction.current = true;
    setTimeout(() => { interaction.current = false; }, 0);
  };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: createMarkdownExtensions({ placeholder, images: () => images.current }),
    content: '',
    editable: !state.readOnly && state.lifecycle === 'active',
    editorProps: { attributes: { role: 'textbox', 'aria-label': `${title} rich text`, 'aria-multiline': 'true', tabindex: '0', class: 'boring-markdown-content' } },
    onUpdate: ({ editor: current, transaction }) => {
      if (active.current !== controller || !interaction.current || !transaction.docChanged || controller.getSnapshot().lifecycle !== 'active' || controller.getSnapshot().readOnly) return;
      interaction.current = false;
      const markdown = finishRichMarkdown(current.getMarkdown(), controller.getSnapshot().text);
      projected.current = markdown;
      emitted.current = markdown;
      controller.actions.edit(markdown);
    },
  }, [controller]);

  useEffect(() => {
    projected.current = null;
    emitted.current = null;
    interaction.current = false;
    setError(null);
  }, [controller]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || state.text === projected.current) return;
    // Text from outside (a load, a refresh, a discard, the source box) starts with the selection at the beginning, where the browser leaves
    // its caret when the text is replaced. Replacing the whole document would otherwise leave the editor's selection at the end while the
    // caret shows the start: a click there changes nothing the editor sees, so formatting applied to the end, and ProseMirror's own sync
    // after a focus or click put the caret back at the end.
    editor.chain().setContent(state.text, { contentType: 'markdown', emitUpdate: false }).setTextSelection(0).run();
    projected.current = state.text;
  }, [editor, state.text]);
  useEffect(() => { editor?.setEditable(!state.readOnly && state.lifecycle === 'active'); }, [editor, state.readOnly, state.lifecycle]);

  const mounted = useMemo(() => {
    if (mode === 'rich' && !editor) return null;
    const current = () => active.current === controller && activeMode.current === mode;
    return mode === 'rich' && editor
      ? createMountedMarkdownTools({ controller, current, view: { kind: 'rich', editor, projectedText: () => projected.current } })
      : createMountedMarkdownTools({ controller, current, view: { kind: 'source', element: () => sourceInput.current } });
  }, [active, controller, editor, mode]);
  useLayoutEffect(() => { mounted?.activate(); return () => mounted?.dispose(); }, [mounted]);
  useEffect(() => {
    if (!mounted || !onMountedTools) return;
    onMountedTools(mounted.tools);
    return () => onMountedTools(null);
  }, [mounted, onMountedTools]);

  const marks = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive('bold'), italic: current.isActive('italic'), strike: current.isActive('strike'), code: current.isActive('code'), highlight: current.isActive('highlight'),
    h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
    bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), task: current.isActive('taskList'),
    quote: current.isActive('blockquote'), codeBlock: current.isActive('codeBlock'), link: current.isActive('link'), table: current.isActive('table'),
    href: current.isActive('link') ? String(current.getAttributes('link')['href'] ?? '') : '',
  } : null });
  const outline = useEditorState({ editor, selector: ({ editor: current }) => {
    if (!current) return null;
    const headings: { position: number; level: number; text: string }[] = [];
    current.state.doc.descendants((node, position) => {
      if (node.type.name === 'heading') headings.push({ position, level: Number(node.attrs['level']), text: node.textContent });
    });
    return { document: current.state.doc, headings };
  }, equalityFn: (left, right) => left?.document === right?.document });
  const switchMode = () => {
    const current = controller.getSnapshot();
    if (mode === 'rich') {
      richBookmark.current = editor && !editor.isDestroyed && projected.current === current.text
        ? { version: current.bufferVersion, selection: editor.state.selection.getBookmark() } : null;
    } else {
      const input = sourceInput.current;
      sourceBookmark.current = input?.value === current.text
        ? { version: current.bufferVersion, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
    }
    interaction.current = false;
    focusAfterSwitch.current = true;
    const next = mode === 'source' ? 'rich' : 'source';
    if (controlledMode === undefined) setOwnMode(next);
    onModeChange?.(next);
  };
  useEffect(() => {
    if (!focusAfterSwitch.current || active.current !== controller || state.lifecycle !== 'active') return;
    if (mode === 'source') {
      const input = sourceInput.current;
      if (!input) return;
      const bookmark = sourceBookmark.current;
      input.focus();
      if (bookmark?.version === state.bufferVersion) input.setSelectionRange(bookmark.start, bookmark.end, bookmark.direction);
      else input.setSelectionRange(0, 0);
    } else {
      if (!editor || editor.isDestroyed) return;
      const bookmark = richBookmark.current;
      if (bookmark?.version === state.bufferVersion) editor.view.dispatch(editor.state.tr.setSelection(bookmark.selection.resolve(editor.state.doc)));
      else editor.commands.setTextSelection(0);
      editor.commands.focus(undefined, { scrollIntoView: false });
    }
    focusAfterSwitch.current = false;
  }, [active, controller, editor, mode, state.bufferVersion, state.lifecycle]);
  const unavailable = state.readOnly || state.lifecycle !== 'active';
  const pending = state.save.kind === 'pending';
  const outcome = state.save.kind === 'settled' ? state.save.result : null;
  const uncertain = outcome?.kind === 'unknown';
  const conflict = outcome?.kind === 'conflict' || state.remote !== null;
  const save = () => {
    const selected = controller.actions.selection();
    setError(null);
    void controller.flush(selected).then(report, () => { if (active.current === controller) setError('The save could not be completed. Your text is still available.'); });
  };
  /** Shows a refused save or accept; the buffer keeps the text. */
  const report = (result: unknown) => {
    if (active.current !== controller || !result || typeof result !== 'object') return;
    const { kind, reason } = result as { kind?: unknown; reason?: unknown };
    if (kind === 'denied' || kind === 'conflict' || kind === 'unavailable') setError(typeof reason === 'string' && reason ? reason : kind === 'conflict' ? 'The document changed elsewhere. Your text is still available.' : 'The document could not be saved. Your text is still available.');
  };
  const run = (operation: () => Promise<unknown>) => {
    setError(null);
    void operation().then(report, () => { if (active.current === controller) setError('The operation could not be completed. Your text is still available.'); });
  };
  const richOnly = unavailable || mode === 'source' || !editor;
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const command = (operation: () => unknown) => { interaction.current = true; try { operation(); } finally { interaction.current = false; } };
  const tool = (label: string, icon: MarkdownIconName, pressed: boolean | undefined, operation: () => unknown, extra: { disabled?: boolean } = {}) => (
    <button type="button" className="boring-markdown-tool" aria-label={label} title={label} aria-pressed={pressed === true} data-active={pressed === true || undefined}
      disabled={richOnly || extra.disabled} onClick={() => command(operation)}><MarkdownIcon name={icon} /></button>
  );
  const separator = <span role="separator" aria-orientation="vertical" className="boring-markdown-separator" />;
  const chain = () => editor!.chain().focus();
  const openLink = () => setLinkDraft(marks?.href ?? '');
  const applyLink = () => {
    const href = (linkDraft ?? '').trim();
    if (!editor || /^(?:javascript|data|vbscript):/i.test(href)) return;
    command(() => href === '' ? chain().extendMarkRange('link').unsetLink().run() : chain().extendMarkRange('link').setLink({ href }).run());
    setLinkDraft(null);
  };

  return <section className={className} data-boring="markdown-editor" data-mode={mode} data-dirty={state.dirty || undefined}
    onKeyDownCapture={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!unavailable && !pending && !uncertain) save(); }
    }}>
    {header && <header>
      <strong>{title}</strong>
      {state.readOnly && <span>Read only</span>}
      <span role="status">{state.lifecycle === 'disposed' ? 'Closed' : pending ? 'Saving' : uncertain ? 'Save unconfirmed' : conflict ? 'Changed elsewhere' : state.dirty ? 'Unsaved changes' : 'Saved'}</span>
      <button type="button" aria-pressed={mode === 'source'} disabled={!richOffered} onClick={switchMode}>Markdown source</button>
      <button type="button" disabled={unavailable || !state.dirty || pending || uncertain} onClick={save}>Save</button>
    </header>}
    <TextDraftControls recovery={state.recovery} actions={controller.actions} readOnly={state.readOnly} blocked={state.lifecycle !== 'active' || state.save.kind === 'pending' || (state.save.kind === 'settled' && state.save.result.kind === 'unknown')} />
    {mode === 'rich' && <div role="toolbar" aria-label="Text formatting" className="boring-markdown-toolbar">
      {tool('Bold', 'Bold', marks?.bold, () => chain().toggleBold().run())}
      {tool('Italic', 'Italic', marks?.italic, () => chain().toggleItalic().run())}
      {tool('Strikethrough', 'Strike', marks?.strike, () => chain().toggleStrike().run())}
      {tool('Highlight', 'Highlight', marks?.highlight, () => chain().toggleHighlight().run())}
      {tool('Code', 'Code', marks?.code, () => chain().toggleCode().run())}
      {separator}
      {tool('Heading 1', 'Heading1', marks?.h1, () => chain().toggleHeading({ level: 1 }).run())}
      {tool('Heading 2', 'Heading2', marks?.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {tool('Heading 3', 'Heading3', marks?.h3, () => chain().toggleHeading({ level: 3 }).run())}
      {separator}
      {tool('Bullet list', 'BulletList', marks?.bullet, () => chain().toggleBulletList().run())}
      {tool('Numbered list', 'OrderedList', marks?.ordered, () => chain().toggleOrderedList().run())}
      {tool('Task list', 'TaskList', marks?.task, () => chain().toggleTaskList().run())}
      {separator}
      {tool('Quote', 'Quote', marks?.quote, () => chain().toggleBlockquote().run())}
      {tool('Code block', 'CodeBlock', marks?.codeBlock, () => chain().toggleCodeBlock().run())}
      {tool('Link', 'Link', marks?.link || linkDraft !== null, openLink)}
      {tool('Table', 'Table', marks?.table, () => marks?.table ? chain().deleteTable().run() : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {tool('Horizontal rule', 'Rule', false, () => chain().setHorizontalRule().run())}
      {marks?.table && <>{separator}
        {tool('Add table row', 'Rows', false, () => chain().addRowAfter().run())}
        {tool('Add table column', 'Columns', false, () => chain().addColumnAfter().run())}
        {tool('Delete table', 'Trash', false, () => chain().deleteTable().run())}</>}
    </div>}
    {mode === 'rich' && linkDraft !== null && <form className="boring-markdown-link" aria-label="Link address" onSubmit={event => { event.preventDefault(); applyLink(); }}>
      <input type="text" inputMode="url" autoFocus aria-label="Link address" placeholder="https://" value={linkDraft} onChange={event => setLinkDraft(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setLinkDraft(null); editor?.commands.focus(); } }} />
      <button type="submit">{linkDraft.trim() === '' && marks?.link ? 'Remove link' : 'Apply link'}</button>
      <button type="button" onClick={() => { setLinkDraft(null); editor?.commands.focus(); }}>Cancel</button>
    </form>}
    {!richOffered && <p role="note" className="boring-markdown-notice" data-testid="markdown-source-only">{describeUnsafe(safety)}</p>}
    {mode === 'rich' && outline && outline.headings.length > 0 && <nav aria-label="Document outline">
      <ol>{outline.headings.map((heading, index) => <li key={heading.position} data-heading-level={heading.level}>
        <button type="button" aria-label={`Go to heading: ${heading.text || 'Untitled heading'}`} disabled={state.lifecycle !== 'active'} onClick={() => {
          if (!editor || editor.isDestroyed || active.current !== controller || controller.getSnapshot().lifecycle !== 'active'
            || controller.getSnapshot().bufferVersion !== state.bufferVersion || editor.state.doc !== outline.document) return;
          const node = editor.state.doc.nodeAt(heading.position);
          if (node?.type.name !== 'heading' || node.textContent !== heading.text || node.attrs['level'] !== heading.level) return;
          const target = mounted?.tools.getTarget();
          if (target) void mounted?.tools.revealHeading.invoke(target, { index, expiresAt: Date.now() + 5000 }).then(result => {
            if (active.current === controller && result.kind !== 'applied' && result.kind !== 'proposed') setError(result.reason);
          }).catch(() => { if (active.current === controller) setError('The heading could not be selected'); });
        }}>{heading.text || 'Untitled heading'}</button>
      </li>)}</ol>
    </nav>}
    {uncertain && <div role="alert" className="boring-markdown-alert">Save acknowledgement was lost. Keep editing while its outcome is checked.
      <button type="button" onClick={() => run(controller.actions.reconcile)}>Check save outcome</button>
      <button type="button" onClick={() => run(controller.actions.abandon)}>Stop checking and refresh, keeping my draft</button>
    </div>}
    {conflict && <div role="alert" className="boring-markdown-alert">The saved document changed. Your local text has been kept.
      <button type="button" disabled={pending || uncertain} onClick={() => run(controller.actions.refresh)}>Check saved version</button>
      <button type="button" disabled={pending || uncertain} onClick={() => run(controller.actions.discardToRemote)}>Discard local changes and reload</button>
    </div>}
    {(outcome?.kind === 'denied' || outcome?.kind === 'unavailable') && <p role="alert" className="boring-markdown-alert">{outcome.reason}</p>}
    {error && <p role="alert" className="boring-markdown-alert">{error}</p>}
    {state.proposals.map(proposal => <article key={proposal.id} data-boring="proposal" className="boring-markdown-proposal">
      <h3>{proposal.summary || 'Proposed edit'}</h3>
      <details><summary>Review text changes</summary><MarkdownProposalDiff proposal={proposal} />
        <details><summary>Exact before and after</summary><h4>Before</h4><pre>{proposal.before}</pre><h4>After</h4><pre>{proposal.after}</pre></details>
      </details>
      <button type="button" disabled={unavailable || pending || uncertain || proposal.adopted} onClick={() => run(() => controller.actions.accept(proposal.id))}>{proposal.adopted ? 'Adopted' : 'Accept and save'}</button>
      <button type="button" onClick={() => controller.actions.reject(proposal.id)}>Dismiss proposal</button>
    </article>)}
    {mode === 'source'
      ? <textarea ref={sourceInput} className="boring-markdown-source" aria-label={`${title} Markdown source`} value={state.text} readOnly={unavailable} spellCheck={false} onChange={event => controller.actions.edit(event.currentTarget.value)} />
      : <div className="boring-markdown-surface" onKeyDownCapture={markInteraction} onBeforeInputCapture={markInteraction} onInputCapture={markInteraction} onPasteCapture={markInteraction} onDropCapture={markInteraction}
        onChangeCapture={markInteraction}
        onClickCapture={event => { markInteraction(); if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }}
        onAuxClickCapture={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }}>
        <EditorContent editor={editor} />
      </div>}
  </section>;
}
