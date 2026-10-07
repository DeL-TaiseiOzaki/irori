import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react';
import { Editor, type EditorHandle } from '../editor/Editor';
import {
  frontmatterHead,
  splitPage,
  stampLastChange,
  type PageProperties as Declared,
} from '../domain/properties';
import { PageProperties } from './PageProperties';
import { baseName } from '../domain/paths';

export interface PageEditorHandle extends EditorHandle {
  /**
   * Names the person as the last to change the page, in the editor's own text,
   * and returns the text to save. Undefined when nothing is to be stamped.
   */
  stamp?(): string | undefined;
}

/**
 * The note editor, with a knowledge page's properties above its body (ADR 015).
 * In the rich view the frontmatter is held here and the editor edits only the
 * body; any other file stays whole in the editor. Either way `getText` is the
 * whole file, byte for byte when nothing changed.
 */
export function PageEditor({
  ref,
  page,
  properties,
  text,
  mode,
  onChange,
  searchTarget,
  onSearchResult,
  filename,
  readOnly = false,
  ...rest
}: Omit<ComponentProps<typeof Editor>, 'ref'> & {
  ref?: Ref<PageEditorHandle>;
  /** Whether this file is a knowledge page that shows properties. */
  page: boolean;
  properties: Declared | null | undefined;
}) {
  const inner = useRef<EditorHandle>(null);
  const initial = useRef(splitPage(text));
  // A BOM before a page without frontmatter stays with the body; no head is added there.
  const split = page && mode === 'rich' && !(initial.current.bom && !initial.current.head);
  const head = useRef(split ? initial.current.head : '');
  const [yaml, setYaml] = useState(split ? initial.current.yaml : undefined);
  const declared = useRef(properties);
  declared.current = properties;
  const change = useRef(onChange);
  change.current = onChange;
  const headLines = head.current.split('\n').length - 1;
  const inHead = !!searchTarget && split && searchTarget.line <= headLines;

  const whole = () => {
    const body = inner.current?.getText() ?? (split ? initial.current.body : text);
    return split ? head.current + body : body;
  };
  function setHeadYaml(next: string) {
    head.current = frontmatterHead(next, initial.current.newline, initial.current.bom);
    setYaml(next);
    change.current(whole());
  }
  useImperativeHandle(
    ref,
    () => ({
      getText: whole,
      // Lines count from the top of the file; in the rich view the editor holds only the body.
      selection: () => {
        const selected = inner.current?.selection();
        return selected?.line ? { ...selected, line: selected.line + headLines } : selected;
      },
      reveal: (quote, line) =>
        inner.current?.reveal(quote, line && line > headLines ? line - headLines : undefined) ??
        false,
      stamp: () => {
        const current = declared.current;
        // Markdown notes open in the rich view; only there is the frontmatter held here.
        if (!split || readOnly || !current?.declaration || !current.actor) return undefined;
        const before = whole();
        const after = stampLastChange(before, current.declaration, current.actor, new Date());
        if (after === before) return before;
        const next = splitPage(after);
        head.current = next.head;
        setYaml(next.yaml);
        change.current(after);
        return after;
      },
    }),
    [readOnly, split, headLines],
  );
  // A search hit inside the frontmatter is on show in the properties above.
  useEffect(() => {
    if (inHead) onSearchResult?.(true);
  }, []);

  const editor = (
    <Editor
      {...rest}
      ref={inner}
      text={split ? initial.current.body : text}
      mode={mode}
      filename={filename}
      readOnly={readOnly}
      onChange={(body) => change.current(split ? head.current + body : body)}
      searchTarget={
        split && searchTarget && !inHead
          ? { ...searchTarget, line: searchTarget.line - headLines }
          : inHead
            ? undefined
            : searchTarget
      }
      onSearchResult={onSearchResult}
    />
  );
  if (!split) return editor;
  return (
    <>
      <PageProperties
        yaml={yaml}
        declared={properties}
        readOnly={readOnly}
        fileName={baseName(filename ?? '')}
        onChange={setHeadYaml}
      />
      {editor}
    </>
  );
}
