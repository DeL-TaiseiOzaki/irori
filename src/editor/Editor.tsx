import { useEffect, useRef, useImperativeHandle, type Ref } from 'react';
import { Crepe } from '@milkdown/crepe';
import { serializerCtx } from '@milkdown/kit/core';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { literalBlock, preserveBlocks, documentEncoding } from './preservation';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { basicSetup } from 'codemirror';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
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
}: {
  text: string;
  mode: 'rich' | 'source';
  onChange: (text: string) => void;
  onUpload?: (file: File) => Promise<string>;
  resolveImage?: (url: string) => Promise<string>;
  onError?: (error: unknown) => void;
  ref?: Ref<EditorHandle>;
  readOnly?: boolean;
}) {
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
  return <div className={`document-editor ${mode}`} ref={root} data-testid="document-editor" />;
}
