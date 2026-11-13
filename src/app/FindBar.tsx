import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { findAll } from '../domain/find';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

/** How many occurrences a search found, and which to show first. */
export interface FindCount {
  count: number;
  /** The first at or after where the person is: the last one shown, the cursor or the view. */
  start: number;
}

/**
 * What a file's view does for the find bar (Ctrl+F): the note editor, the CSV table
 * and the viewers each find in their own content and mark it their own way.
 */
export interface Finder {
  /** Marks every occurrence of the query; an empty query takes the marks away. */
  find(query: string): FindCount | Promise<FindCount>;
  /** Shows the occurrence at `index` as the current one, scrolled into view when asked. */
  show(index: number, scroll: boolean): void;
  /**
   * Takes every mark away. With `select`, an editor selects the current occurrence
   * and takes the focus; true when it did.
   */
  clear(select: boolean): boolean;
}

interface Registry {
  register(finder: Finder): () => void;
  changed(finder: Finder): void;
}
const FindContext = createContext<Registry | null>(null);

/**
 * Offers a view's finder to the find bar around it, if there is one; a preview in
 * another stage column has none. Returns what the view calls when its content
 * changed, so the bar searches again.
 */
export function useFinder(finder: Finder) {
  const registry = useContext(FindContext);
  useEffect(() => registry?.register(finder), [registry, finder]);
  return useCallback(() => registry?.changed(finder), [registry, finder]);
}

export interface FindScopeHandle {
  /** Shows the find bar with its field focused. */
  open(): void;
}

const mac = () => /Mac/i.test(navigator.platform);

/**
 * The find bar of the file on show, and the keys that open and step it. It sits
 * above the file's scrolling view, so it never covers a viewer's own controls, and
 * searches the view inside that offers a finder.
 */
export function FindScope({
  ref,
  hidden = false,
  children,
}: {
  ref?: Ref<FindScopeHandle>;
  /** While the file is not on show, the bar is hidden and its keys do nothing. */
  hidden?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [finder, setFinder] = useState<Finder>();
  const [found, setFound] = useState<{ count: number; index: number }>();
  const [searching, setSearching] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const ticket = useRef(0);
  const refresh = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef({ open, query, finder, found, hidden });
  live.current = { open, query, finder, found, hidden };

  async function search(target: Finder, text: string, keep: number | undefined, scroll: boolean) {
    const mine = ++ticket.current;
    setSearching(true);
    let result: FindCount;
    try {
      result = await target.find(text);
    } catch {
      result = { count: 0, start: 0 };
    }
    if (mine !== ticket.current) return;
    setSearching(false);
    if (!result.count) {
      setFound(text ? { count: 0, index: -1 } : undefined);
      return;
    }
    const index = Math.min(keep ?? result.start, result.count - 1);
    target.show(index, scroll);
    setFound({ count: result.count, index });
  }

  const registry = useMemo<Registry>(
    () => ({
      register(next) {
        setFinder(next);
        return () => setFinder((current) => (current === next ? undefined : current));
      },
      // An edit or a redraw searches again where the person is, without scrolling.
      changed(which) {
        clearTimeout(refresh.current);
        refresh.current = setTimeout(() => {
          const { open: shown, query: text, finder: current, found: last } = live.current;
          if (shown && text && which === current)
            void search(current, text, last && last.index >= 0 ? last.index : undefined, false);
        }, 150);
      },
    }),
    [],
  );
  useEffect(() => () => clearTimeout(refresh.current), []);

  useEffect(() => {
    if (!open || !finder) {
      ticket.current++;
      setSearching(false);
      setFound(undefined);
      return;
    }
    void search(finder, query, undefined, true);
  }, [open, query, finder]);

  function show() {
    const { open: shown } = live.current;
    const area = bar.current?.parentElement;
    if (!bar.current?.contains(document.activeElement)) {
      if (!shown) opener.current = document.activeElement as HTMLElement | null;
      // Words selected in the file are what is looked for, as in a browser.
      const selection = window.getSelection();
      const selected = selection?.toString() ?? '';
      if (
        selected.trim() &&
        !selected.includes('\n') &&
        selected.length <= 200 &&
        selection?.anchorNode &&
        area?.contains(selection.anchorNode)
      )
        setQuery(selected);
    }
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }
  useImperativeHandle(ref, () => ({ open: show }), []);

  function step(by: 1 | -1) {
    const { finder: current, found: last } = live.current;
    if (!current || !last?.count) return;
    const index = (last.index + by + last.count) % last.count;
    current.show(index, true);
    setFound({ count: last.count, index });
  }

  function close() {
    const { finder: current, found: last } = live.current;
    ticket.current++;
    const focused = current?.clear(!!last?.count) ?? false;
    const hadFocus = bar.current?.contains(document.activeElement);
    setOpen(false);
    setFound(undefined);
    if (!focused && hadFocus && opener.current?.isConnected) opener.current.focus();
  }

  // The keys are taken before an editor sees them, so the source view's own search
  // panel never opens over the file. They act only while the file is on show and
  // nothing modal is over it; the terminal keeps Ctrl+F for the shell.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (live.current.hidden || !bar.current?.parentElement?.checkVisibility()) return;
    const target = event.target as Element | null;
    if (target?.closest?.('.terminal-panel, dialog') || document.querySelector('dialog[open]'))
      return;
    const command = mac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const letter = event.key.toLowerCase();
    if (command && !event.altKey && !event.shiftKey && letter === 'f') {
      event.preventDefault();
      event.stopPropagation();
      show();
    } else if (
      (event.key === 'F3' && !event.altKey && !event.ctrlKey && !event.metaKey) ||
      (command && !event.altKey && letter === 'g')
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (live.current.open && live.current.query) step(event.shiftKey ? -1 : 1);
      else show();
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const count = !query
    ? ''
    : !finder
      ? t('検索できません', 'Nothing to search')
      : searching && !found
        ? '…'
        : !found?.count
          ? t('見つかりません', 'No results')
          : `${found.index + 1} / ${found.count}`;
  return (
    <FindContext.Provider value={registry}>
      <div
        ref={bar}
        className="find-bar"
        role="search"
        aria-label={t('ファイル内検索', 'Find in file')}
        hidden={!open || hidden}
      >
        {open && (
          <>
            <div className="find-field">
              <Icon name="search" size={14} className="find-icon" />
              <input
                ref={input}
                className={query && found?.count === 0 ? 'missing' : ''}
                value={query}
                placeholder={t('ファイル内を検索', 'Find in file')}
                aria-label={t('ファイル内を検索', 'Find in file')}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    step(event.shiftKey ? -1 : 1);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                  }
                }}
              />
              <span className="find-count" role="status">
                {count}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={t('前の一致', 'Previous match')}
              title={t('前の一致 (Shift+Enter)', 'Previous match (Shift+Enter)')}
              disabled={!found?.count}
              onClick={() => step(-1)}
            >
              <Icon name="up" size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={t('次の一致', 'Next match')}
              title={t('次の一致 (Enter)', 'Next match (Enter)')}
              disabled={!found?.count}
              onClick={() => step(1)}
            >
              <Icon name="down" size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={t('検索を閉じる', 'Close find')}
              title={t('閉じる (Esc)', 'Close (Esc)')}
              onClick={close}
            >
              <Icon name="close" size={14} />
            </button>
          </>
        )}
      </div>
      {children}
    </FindContext.Provider>
  );
}

/**
 * A cell's text with each occurrence of the query marked, for views that draw
 * their text with React (the CSV table, a spreadsheet). `current` is the offset
 * of the current occurrence in this text, if it is here.
 */
export function FindMarks({
  text,
  query,
  current,
}: {
  text: string;
  query: string;
  current?: number;
}) {
  const at = query ? findAll(text, query) : [];
  if (!at.length) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  for (const start of at) {
    if (start > from) parts.push(text.slice(from, start));
    parts.push(
      <mark key={start} className={start === current ? 'find-hit current' : 'find-hit'}>
        {text.slice(start, start + query.length)}
      </mark>,
    );
    from = start + query.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

/** Scrolls an element to the middle of the view it is shown in. */
export function reveal(element: Element | null | undefined) {
  element?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

// Views whose text is a document's DOM (Word, slides, a PDF's text layer) mark it
// with the CSS Custom Highlight API, which draws without changing the DOM.
const hitsName = 'irori-find';
const currentName = 'irori-find-current';

/** The highlight rules, for a view whose content sits in a shadow root of its own. */
export const findHighlightStyle = `::highlight(${hitsName}) { background-color: rgba(47, 95, 208, 0.22); }
  ::highlight(${currentName}) { background-color: rgba(47, 95, 208, 0.5); }`;

/** Marks these ranges as occurrences, and one as the current; no ranges takes the marks away. */
export function paintHighlights(ranges: Range[], current?: Range) {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  if (!ranges.length) {
    CSS.highlights.delete(hitsName);
    CSS.highlights.delete(currentName);
    return;
  }
  const hits = new Highlight();
  for (const range of ranges) if (range !== current) hits.add(range);
  CSS.highlights.set(hitsName, hits);
  const top = new Highlight();
  if (current) top.add(current);
  top.priority = 1;
  CSS.highlights.set(currentName, top);
}

/** Elements that hold a line or a cell of their own: text is not matched across them. */
const blocks =
  'p,div,li,td,th,tr,table,section,article,h1,h2,h3,h4,h5,h6,pre,blockquote,dt,dd,caption,figcaption';

/** Where a query occurs in the text under `root`, as DOM ranges in reading order. */
export function textRanges(root: Node, query: string): Range[] {
  const ranges: Range[] = [];
  if (!query) return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('style,script,noscript,template')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let block: Element | null | undefined;
  let text = '';
  let pieces: { node: Text; at: number }[] = [];
  const point = (offset: number, end: boolean) => {
    // The piece holding the character at `offset` (the one before it, for an end).
    const at = end ? offset - 1 : offset;
    let index = pieces.length - 1;
    while (index > 0 && pieces[index].at > at) index--;
    return { node: pieces[index].node, offset: offset - pieces[index].at };
  };
  const flush = () => {
    for (const start of findAll(text, query)) {
      const from = point(start, false);
      const to = point(start + query.length, true);
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      ranges.push(range);
    }
    text = '';
    pieces = [];
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement?.closest(blocks) ?? null;
    if (owner !== block) {
      flush();
      block = owner;
    }
    pieces.push({ node: node as Text, at: text.length });
    text += (node as Text).data;
  }
  flush();
  return ranges;
}

/** The top of the stage's view of the file a node is in, in window coordinates. */
export function viewTop(node: Node | undefined) {
  const element =
    node instanceof ShadowRoot ? node.host : node instanceof Element ? node : node?.parentElement;
  return element?.closest('.document-scroll')?.getBoundingClientRect().top ?? 0;
}

/**
 * A finder over a rendered document's text: Word pages and slides. `roots` gives
 * where the text is now; it is read again on every search.
 */
export function domFinder(roots: () => Node[]): Finder {
  let ranges: Range[] = [];
  let current = -1;
  return {
    find(query) {
      const previous = ranges[current];
      ranges = roots().flatMap((root) => textRanges(root, query));
      current = -1;
      paintHighlights(ranges);
      let start: number | undefined;
      if (previous)
        try {
          start = ranges.findIndex(
            (range) => range.compareBoundaryPoints(Range.START_TO_START, previous) >= 0,
          );
        } catch {
          // The text was drawn again since; where the view is decides instead.
        }
      start ??= ranges.findIndex(
        (range) => range.getBoundingClientRect().bottom > viewTop(roots()[0]),
      );
      return { count: ranges.length, start: Math.max(0, start) };
    },
    show(index, scroll) {
      current = index;
      const range = ranges[index];
      paintHighlights(ranges, range);
      if (scroll && range) reveal(range.startContainer.parentElement);
    },
    clear() {
      ranges = [];
      current = -1;
      paintHighlights([]);
      return false;
    },
  };
}
