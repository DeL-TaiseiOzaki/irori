import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar as toolbarFeature } from '@milkdown/crepe/feature/toolbar';
import { languages } from '@codemirror/language-data';
import { serializerCtx, editorViewCtx, remarkCtx } from '@milkdown/kit/core';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { richMatch, sourceMatch, type SearchTarget } from './search-navigation';
import { $prose } from '@milkdown/kit/utils';
import { literalBlock, preserveBlocks, documentEncoding } from './preservation';
import type { NoteAuthorship } from '../domain/knowledge';
import { EditorView, GutterMarker, gutter, ViewPlugin } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { assistanceExtensions, editingCore, languageForFilename } from './assistance';
import { t } from '../domain/i18n';
// Crepe's own entry point and its combined stylesheet are flattened bundles that
// import KaTeX and its fonts unconditionally, so `features: { Latex: false }` —
// a runtime flag read after bundling — never removed them. Composing the builder
// from the features this editor uses, and importing each feature's stylesheet,
// keeps the behaviour and leaves the maths engine out. What the removed default
// configuration added is a CodeMirror theme this file already overrides.
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import '@milkdown/crepe/theme/frame.css';
// CodeMirror ships a light-only default theme. Expressing the source editor in
// design tokens instead lets one definition follow the document theme, so the
// rendered and the source view never disagree about the palette.
const sourceTheme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--paper)' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--surface-selected)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--surface-sunken)' },
  '.cm-gutters': {
    color: 'var(--ink-faint)',
    backgroundColor: 'var(--surface-sunken)',
    border: 'none',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-selected)', color: 'var(--ink)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--ember-wash)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-selected)',
    color: 'var(--muted)',
    border: 'none',
  },
  '.cm-panels, .cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--ink)',
    border: '1px solid var(--rule)',
  },
});

const sourceHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ink)', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--ember-ink)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--danger)' },
  { tag: tags.quote, color: 'var(--muted)' },
  { tag: [tags.processingInstruction, tags.punctuation, tags.meta], color: 'var(--ink-faint)' },
  { tag: tags.list, color: 'var(--ember-ink)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--ember-ink)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--added)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--ember-ink)' },
  { tag: tags.typeName, color: 'var(--danger)' },
  { tag: tags.function(tags.variableName), color: 'var(--ink)', fontWeight: '600' },
  { tag: tags.attributeName, color: 'var(--ember-ink)' },
  { tag: tags.invalid, textDecoration: 'underline wavy var(--danger)' },
]);

// Crepe's editor chrome ships English copy by default; the interface language
// supplies these strings instead. A function, not a module-level constant, so
// each editor instance reads the language current when it is created.
function editorChrome() {
  return {
    placeholder: { text: t('本文を入力…', 'Type here…') },
    linkTooltip: {
      inputPlaceholder: t('リンク先を貼り付け…', 'Paste a link…'),
      editButton: t('編集', 'Edit'),
      removeButton: t('削除', 'Remove'),
      confirmButton: t('確定', 'Confirm'),
    },
    codeMirror: {
      languages,
      // Code blocks inside the note are CodeMirror as well; share the token theme.
      theme: sourceTheme,
      searchPlaceholder: t('言語を検索…', 'Search languages…'),
      noResultText: t('該当する言語がありません', 'No matching language'),
      copyText: t('コピー', 'Copy'),
      previewLabel: t('プレビュー', 'Preview'),
    },
    blockEdit: {
      textGroup: {
        label: t('テキスト', 'Text'),
        text: { label: t('本文', 'Text') },
        h1: { label: t('見出し 1', 'Heading 1') },
        h2: { label: t('見出し 2', 'Heading 2') },
        h3: { label: t('見出し 3', 'Heading 3') },
        h4: { label: t('見出し 4', 'Heading 4') },
        h5: { label: t('見出し 5', 'Heading 5') },
        h6: { label: t('見出し 6', 'Heading 6') },
        quote: { label: t('引用', 'Quote') },
        divider: { label: t('区切り線', 'Divider') },
      },
      listGroup: {
        label: t('リスト', 'List'),
        bulletList: { label: t('箇条書き', 'Bullet list') },
        orderedList: { label: t('番号付き', 'Numbered list') },
        taskList: { label: t('タスク', 'Task list') },
      },
      advancedGroup: {
        label: t('ブロック', 'Block'),
        image: { label: t('画像', 'Image') },
        codeBlock: { label: t('コード', 'Code') },
        table: { label: t('表', 'Table') },
      },
    },
  };
}

/**
 * A line the person wrote or revised carries a mark in the source gutter. Other
 * lines carry none: the absence of a mark is not a claim that an agent wrote
 * them, and marking every line would say nothing.
 */
class PersonLine extends GutterMarker {
  elementClass = 'cm-authored-person';
  toDOM() {
    return document.createTextNode('');
  }
}
const personLine = new PersonLine();

export interface EditorHandle {
  getText(): string;
}
export function Editor({
  text,
  mode,
  onChange,
  onUpload,
  resolveImage,
  onError,
  ref,
  readOnly = false,
  assistance = true,
  filename,
  searchTarget,
  onSearchResult,
  authorship,
  onFollowLink,
}: {
  text: string;
  mode: 'rich' | 'source';
  onChange: (text: string) => void;
  onUpload?: (file: File) => Promise<string>;
  resolveImage?: (url: string) => Promise<string>;
  onError?: (error: unknown) => void;
  ref?: Ref<EditorHandle>;
  readOnly?: boolean;
  assistance?: boolean;
  filename?: string;
  searchTarget?: SearchTarget;
  onSearchResult?: (found: boolean) => void;
  authorship?: NoteAuthorship;
  onFollowLink?: (href: string) => void;
}) {
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const navigation = useRef({ searchTarget, onSearchResult });
  navigation.current = { searchTarget, onSearchResult };
  const authored = useRef(authorship);
  authored.current = authorship;
  const source = useRef<EditorView | null>(null);
  const assistanceConfig = useRef(new Compartment());
  const languageConfig = useRef(new Compartment());
  const assistanceEnabled = useRef(assistance);
  assistanceEnabled.current = assistance;
  const codeBlocks = useRef(new Set<EditorView>());
  const root = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const follow = useRef(onFollowLink);
  follow.current = onFollowLink;
  const initial = useRef(text);
  const snapshot = useRef(() => initial.current);
  useImperativeHandle(ref, () => ({ getText: () => snapshot.current() }), []);
  // The gutter reads the record through a ref, so a new one only needs a repaint.
  useEffect(() => {
    source.current?.dispatch({});
  }, [authorship]);
  useEffect(() => {
    if (!root.current) return;
    let dead = false;
    let ready = false;
    let userEdited = false;
    if (mode === 'source') {
      const view = new EditorView({
        parent: root.current,
        state: EditorState.create({
          doc: initial.current,
          extensions: [
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
            EditorState.lineSeparator.of(initial.current.includes('\r\n') ? '\r\n' : '\n'),
            sourceTheme,
            gutter({
              class: 'cm-authorship',
              lineMarker: (view, line) =>
                authored.current?.lines[view.state.doc.lineAt(line.from).number - 1]
                  ? personLine
                  : null,
            }),
            editingCore,
            assistanceConfig.current.of(
              assistanceExtensions(assistanceEnabled.current, sourceHighlight),
            ),
            languageConfig.current.of([]),
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) change.current(update.state.sliceDoc());
            }),
          ],
        }),
      });
      source.current = view;
      snapshot.current = () => view.state.sliceDoc();
      if (navigation.current.searchTarget) {
        // CodeMirror positions count a line separator as one character, even
        // when sliceDoc preserves the original CRLF encoding on disk.
        const match = sourceMatch(view.state.doc.toString(), navigation.current.searchTarget);
        if (match) {
          view.dispatch({
            selection: { anchor: match.from, head: match.to },
            scrollIntoView: true,
          });
          view.focus();
        }
        navigation.current.onSearchResult?.(!!match);
      }
      return () => {
        source.current = null;
        view.destroy();
      };
    }
    // Give each asynchronous Crepe lifecycle its own root (including React cleanup).
    const element = document.createElement('div');
    root.current.append(element);
    const encoding = documentEncoding(initial.current);
    const markEdited = () => {
      userEdited = true;
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.key === 'Backspace' ||
        event.key === 'Delete' ||
        event.key === 'Enter' ||
        ((event.ctrlKey || event.metaKey) && ['b', 'i', 'z', 'y'].includes(event.key.toLowerCase()))
      )
        markEdited();
    };
    const toolbar = (event: PointerEvent) => {
      if ((event.target as Element).closest('button,[role=menuitem]')) markEdited();
    };
    // A plain click in an editor puts the cursor in the link's text, so following it
    // takes the modifier a code editor uses for the same gesture. The knowledge base's
    // pages link to each other by relative path, and the host resolves what is there.
    const followLink = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey) || !follow.current) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      follow.current(anchor.getAttribute('href') ?? '');
    };
    element.addEventListener('click', followLink, true);
    for (const event of ['beforeinput', 'paste', 'drop'])
      element.addEventListener(event, markEdited, true);
    element.addEventListener('keydown', keyboard, true);
    element.addEventListener('pointerdown', toolbar, true);
    const chrome = editorChrome();
    const crepe = new CrepeBuilder({ root: element, defaultValue: encoding.body })
      .addFeature(cursor)
      .addFeature(listItem)
      .addFeature(toolbarFeature)
      .addFeature(table)
      .addFeature(placeholder, chrome.placeholder)
      .addFeature(linkTooltip, chrome.linkTooltip)
      .addFeature(codeMirror, chrome.codeMirror)
      .addFeature(blockEdit, chrome.blockEdit)
      .addFeature(imageBlock, {
        onUpload: async (file) => {
          try {
            if (readOnly)
              throw Error(t('このノートは読み取り専用です。', 'This note is read-only.'));
            if (!onUpload)
              throw Error(
                t(
                  'このノートには画像を貼り付けられません。',
                  'Images cannot be pasted into this note.',
                ),
              );
            markEdited();
            return await onUpload(file);
          } catch (error) {
            onError?.(error);
            return '';
          }
        },
        proxyDomURL: async (url) => {
          if (!url) return '';
          try {
            return (await resolveImage?.(url)) ?? '';
          } catch {
            if (!dead)
              setImageErrors((errors) =>
                errors.includes(url) ? errors : [...errors, url].slice(0, 10),
              );
            return '';
          }
        },
        blockUploadButton: t('画像を選択', 'Choose image'),
        inlineUploadButton: t('画像を選択', 'Choose image'),
        blockUploadPlaceholderText: t('画像の相対パス', 'Relative path to the image'),
        inlineUploadPlaceholderText: t('画像の相対パス', 'Relative path to the image'),
        blockCaptionPlaceholderText: t('キャプション', 'Caption'),
        blockConfirmButton: t('追加', 'Add'),
      });
    crepe.editor
      .config((ctx) => {
        ctx.update(codeBlockConfig.key, (config) => ({
          ...config,
          // Crepe installs basicSetup unconditionally. Move that bundle into a
          // compartment while retaining its own block keymap and theme.
          extensions: [
            ...config.extensions.filter((extension) => extension !== basicSetup),
            editingCore,
            assistanceConfig.current.of(
              assistanceExtensions(assistanceEnabled.current, sourceHighlight),
            ),
            ViewPlugin.define((view) => {
              if (!dead) codeBlocks.current.add(view);
              // Milkdown creates fenced editors lazily. The preference may have
              // changed after this configuration was created but before the block
              // entered the viewport. Dispatch only after its construction ends.
              queueMicrotask(() => {
                if (!dead && codeBlocks.current.has(view))
                  view.dispatch({
                    effects: assistanceConfig.current.reconfigure(
                      assistanceExtensions(assistanceEnabled.current, sourceHighlight),
                    ),
                  });
              });
              return { destroy: () => codeBlocks.current.delete(view) };
            }),
          ],
        }));
      })
      .use(literalBlock)
      .use(preserveBlocks)
      .use(
        // The debounced Markdown listener can skip a quick save/undo back to its
        // previous value, leaving the saved document and React draft out of sync.
        $prose(
          (ctx) =>
            new Plugin({
              view: () => ({
                update: (view, previous) => {
                  if (ready && !dead && userEdited && !view.state.doc.eq(previous.doc))
                    change.current(encoding.restore(ctx.get(serializerCtx)(view.state.doc)));
                },
              }),
            }),
        ),
      );
    snapshot.current = () =>
      ready && userEdited ? encoding.restore(crepe.getMarkdown()) : initial.current;
    void crepe
      .create()
      .then(() => {
        if (dead) void crepe.destroy();
        else {
          ready = true;
          crepe.setReadonly(readOnly);
          const target = navigation.current.searchTarget;
          if (target) {
            const found = crepe.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              const match = richMatch(
                view.state.doc,
                initial.current,
                target,
                ctx.get(remarkCtx).parse(initial.current),
              );
              if (!match) return false;
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
                  .scrollIntoView(),
              );
              view.focus();
              return true;
            });
            navigation.current.onSearchResult?.(found);
          }
        }
      })
      .catch((error) => {
        if (!dead) onError?.(error);
      });
    return () => {
      dead = true;
      codeBlocks.current.clear();
      const wasReady = ready;
      ready = false;
      element.remove();
      for (const event of ['beforeinput', 'paste', 'drop'])
        element.removeEventListener(event, markEdited, true);
      element.removeEventListener('keydown', keyboard, true);
      element.removeEventListener('pointerdown', toolbar, true);
      if (wasReady) void crepe.destroy();
    };
  }, [mode, readOnly]);
  useEffect(() => {
    const views = source.current ? [source.current] : [...codeBlocks.current];
    for (const view of views)
      view.dispatch({
        effects: [
          assistanceConfig.current.reconfigure(assistanceExtensions(assistance, sourceHighlight)),
          view.scrollSnapshot(),
        ],
      });
  }, [assistance]);
  useEffect(() => {
    const view = source.current;
    if (!view) return;
    let current = true;
    void languageForFilename(filename)
      .then((language) => {
        if (current && source.current === view)
          view.dispatch({
            effects: [languageConfig.current.reconfigure(language), view.scrollSnapshot()],
          });
      })
      .catch((error) => {
        if (current) onError?.(error);
      });
    return () => {
      current = false;
    };
  }, [filename, mode, readOnly]);
  return (
    <>
      {imageErrors.length > 0 && (
        <div className="hint image-errors" role="alert">
          <strong>{t('表示できない画像があります。', 'Some images cannot be shown.')}</strong>
          <p>
            {t(
              '画像ファイルの場所・接続と、対応形式（PNG・JPEG・GIF・WebP、20 MiB 以下）を確認して、ノートを開き直してください。本文の画像リンクは保持しています。',
              "Check the image file's location, connection, and supported format (PNG, JPEG, GIF, WebP, 20 MiB or smaller), then reopen the note. Image links in the body are kept.",
            )}
          </p>
          <ul>
            {imageErrors.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        </div>
      )}
      <div
        className={`document-editor ${mode}`}
        ref={root}
        data-testid="document-editor"
        data-editor-assistance={assistance ? 'on' : 'off'}
      />
    </>
  );
}
