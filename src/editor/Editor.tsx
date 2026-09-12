import { useEffect, useRef, useImperativeHandle, type Ref } from 'react';
import { Crepe } from '@milkdown/crepe';
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
  ref,
}: {
  text: string;
  mode: 'rich' | 'source';
  onChange: (text: string) => void;
  ref?: Ref<EditorHandle>;
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
    const element = root.current;
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
      root: root.current,
      defaultValue: initial.current,
      features: { [Crepe.Feature.ImageBlock]: false, [Crepe.Feature.Latex]: false },
    });
    snapshot.current = () => (ready && userEdited ? crepe.getMarkdown() : initial.current);
    crepe.on((listener) =>
      listener.markdownUpdated((_ctx, value) => {
        if (ready && !dead && userEdited) change.current(value);
      }),
    );
    void crepe.create().then(() => {
      if (dead) void crepe.destroy();
      else ready = true;
    });
    return () => {
      dead = true;
      ready = false;
      for (const event of ['beforeinput', 'paste', 'drop'])
        element.removeEventListener(event, markEdited, true);
      element.removeEventListener('keydown', keyboard, true);
      element.removeEventListener('pointerdown', toolbar, true);
      void crepe.destroy();
    };
  }, [mode]);
  return <div className={`document-editor ${mode}`} ref={root} data-testid="document-editor" />;
}
