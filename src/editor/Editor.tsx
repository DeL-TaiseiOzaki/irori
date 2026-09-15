import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react';
import { Crepe } from '@milkdown/crepe';
import { serializerCtx, editorViewCtx, remarkCtx } from '@milkdown/kit/core';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { richMatch, sourceMatch, type SearchTarget } from './search-navigation';
import { $prose } from '@milkdown/kit/utils';
import { literalBlock, preserveBlocks, documentEncoding } from './preservation';
import { EditorView } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import '@milkdown/crepe/theme/common/style.css';
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
]);

// Crepe's editor chrome ships English copy. The product is Japanese, so the
// strings come from its own configuration rather than from new components.
const japaneseEditorChrome = {
  [Crepe.Feature.Placeholder]: { text: '本文を入力…' },
  [Crepe.Feature.LinkTooltip]: {
    inputPlaceholder: 'リンク先を貼り付け…',
    editButton: '編集',
    removeButton: '削除',
    confirmButton: '確定',
  },
  [Crepe.Feature.CodeMirror]: {
    // Code blocks inside the note are CodeMirror as well; share the token theme.
    theme: [sourceTheme, syntaxHighlighting(sourceHighlight)],
    searchPlaceholder: '言語を検索…',
    noResultText: '該当する言語がありません',
    copyText: 'コピー',
    previewLabel: 'プレビュー',
  },
  [Crepe.Feature.BlockEdit]: {
    textGroup: {
      label: 'テキスト',
      text: { label: '本文' },
      h1: { label: '見出し 1' },
      h2: { label: '見出し 2' },
      h3: { label: '見出し 3' },
      h4: { label: '見出し 4' },
      h5: { label: '見出し 5' },
      h6: { label: '見出し 6' },
      quote: { label: '引用' },
      divider: { label: '区切り線' },
    },
    listGroup: {
      label: 'リスト',
      bulletList: { label: '箇条書き' },
      orderedList: { label: '番号付き' },
      taskList: { label: 'タスク' },
    },
    advancedGroup: {
      label: 'ブロック',
      image: { label: '画像' },
      codeBlock: { label: 'コード' },
      table: { label: '表' },
      math: { label: '数式' },
    },
  },
} as const;

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
  searchTarget,
  onSearchResult,
}: {
  text: string;
  mode: 'rich' | 'source';
  onChange: (text: string) => void;
  onUpload?: (file: File) => Promise<string>;
  resolveImage?: (url: string) => Promise<string>;
  onError?: (error: unknown) => void;
  ref?: Ref<EditorHandle>;
  readOnly?: boolean;
  searchTarget?: SearchTarget;
  onSearchResult?: (found: boolean) => void;
}) {
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const navigation = useRef({ searchTarget, onSearchResult });
  navigation.current = { searchTarget, onSearchResult };
  const root = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const initial = useRef(text);
  const snapshot = useRef(() => initial.current);
  useImperativeHandle(ref, () => ({ getText: () => snapshot.current() }), []);
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
            Prec.high(syntaxHighlighting(sourceHighlight)),
            sourceTheme,
            basicSetup,
            markdown(),
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) change.current(update.state.sliceDoc());
            }),
          ],
        }),
      });
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
      return () => view.destroy();
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
    for (const event of ['beforeinput', 'paste', 'drop'])
      element.addEventListener(event, markEdited, true);
    element.addEventListener('keydown', keyboard, true);
    element.addEventListener('pointerdown', toolbar, true);
    const crepe = new Crepe({
      root: element,
      defaultValue: encoding.body,
      features: { [Crepe.Feature.Latex]: false },
      featureConfigs: {
        ...japaneseEditorChrome,
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file) => {
            try {
              if (readOnly || !onUpload) throw Error('このノートは読み取り専用です。');
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
          blockUploadButton: '画像を選択',
          inlineUploadButton: '画像を選択',
          blockUploadPlaceholderText: '画像の相対パス',
          inlineUploadPlaceholderText: '画像の相対パス',
          blockCaptionPlaceholderText: 'キャプション',
          blockConfirmButton: '追加',
        },
      },
    });
    crepe.editor
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
  return (
    <>
      {imageErrors.length > 0 && (
        <div className="hint image-errors" role="alert">
          <strong>表示できない画像があります。</strong>
          <p>
            画像ファイルの場所・接続と、対応形式（PNG・JPEG・GIF・WebP、20 MiB
            以下）を確認して、ノートを開き直してください。本文の画像リンクは保持しています。
          </p>
          <ul>
            {imageErrors.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={`document-editor ${mode}`} ref={root} data-testid="document-editor" />
    </>
  );
}
