import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { $prose, $view } from '@milkdown/kit/utils';
import { literalBlock } from './preservation';
import { footnoteMark as footnoteMarkPattern, readPiece, wikiLink } from './pieces';

/*
 * A literal block keeps Markdown the editor cannot carry through unchanged
 * (footnotes, wiki links, callouts, HTML, math) as its exact text. Away from the
 * cursor it shows that text as a page would, the way Notion and Obsidian's live
 * preview do; with the cursor in it, the text itself is edited. What is saved
 * never changes.
 */

type Mdast = {
  type: string;
  value?: string;
  children?: Mdast[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

/** Footnote marks are read as text here, so a reference without its definition still shows. */
const footnoteMark = new RegExp(footnoteMarkPattern.source, 'g');

function inline(type: string, className: string, text: string): Mdast {
  return {
    type,
    data: { hName: type, hProperties: { className: [className] } },
    children: [{ type: 'text', value: text }],
  };
}

/** Splits a text node on footnote marks and wiki links into the elements they show as. */
function marks(value: string): Mdast[] {
  const out: Mdast[] = [];
  const pattern = new RegExp(`${wikiLink.source}|${footnoteMark.source}`, 'g');
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    const { kind, label } = readPiece(match[0]);
    if (kind === 'footnote') out.push(inline('sup', 'footnote-mark', label));
    else out.push(inline('span', kind === 'embed' ? 'wiki-link wiki-embed' : 'wiki-link', label));
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function remarkLiteral() {
  const visit = (node: Mdast) => {
    if (!node.children) return;
    // `> [!note] Title` opens a callout; the title line becomes its heading.
    if (node.type === 'blockquote') {
      const first = node.children[0]?.children?.[0];
      const callout =
        first?.type === 'text' ? /^\[!([\w-]+)\][+-]?[ \t]*([^\n]*)\n?/.exec(first.value!) : null;
      if (callout && first) {
        const kind = callout[1].toLowerCase();
        first.value = first.value!.slice(callout[0].length);
        node.data = { hName: 'div', hProperties: { className: ['callout', `callout-${kind}`] } };
        node.children.unshift({
          type: 'paragraph',
          data: { hProperties: { className: ['callout-title'] } },
          children: [{ type: 'text', value: callout[2] || kind[0].toUpperCase() + kind.slice(1) }],
        });
      }
    }
    // A footnote's definition, `[^name]: text`, shows its name before its text.
    if (node.type === 'paragraph') {
      const first = node.children[0];
      const definition =
        first?.type === 'text' ? /^\[\^([^\]\s]+)\]:[ \t]*/.exec(first.value!) : null;
      if (definition && first) {
        first.value = first.value!.slice(definition[0].length);
        node.data = { hProperties: { className: ['footnote-definition'] } };
        node.children.unshift(inline('sup', 'footnote-mark', definition[1]));
      }
    }
    node.children = node.children.flatMap((child) =>
      child.type === 'text' && child.value ? marks(child.value) : (visit(child), [child]),
    );
  };
  return (tree: Mdast) => visit(tree);
}

/** Footnote marks become text before GFM reads them, outside code. */
function withoutFootnoteSyntax(text: string) {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/)
    .map((part, index) => (index % 2 ? part : part.replace(footnoteMark, '\\[^$1]')))
    .join('');
}

// Nothing in a preview leaves the editor: a link is its text, an image its description.
const components: Components = {
  a: ({ children }) => <span className="literal-link">{children}</span>,
  img: ({ alt, src }) => <span className="literal-image">{alt || String(src ?? '')}</span>,
};

/** Text that stays as it is written: frontmatter, which page properties stand for. */
const rawOnly = (text: string) => /^(---|\+\+\+)\n/.test(text);

class LiteralView implements NodeView {
  dom = document.createElement('div');
  contentDOM: HTMLElement;
  private preview = document.createElement('div');
  private root: Root;
  private text = '';
  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom.className = 'literal-view';
    this.preview.className = 'literal-preview';
    this.preview.contentEditable = 'false';
    const pre = document.createElement('pre');
    pre.className = 'literal-block';
    pre.dataset.iroriLiteral = '';
    this.contentDOM = pre.appendChild(document.createElement('code'));
    this.dom.append(this.preview, pre);
    this.root = createRoot(this.preview);
    // Clicking what the text shows as puts the cursor in the text.
    this.preview.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const at = this.getPos();
      if (at === undefined) return;
      this.view.dispatch(
        this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, at + 1)),
      );
      this.view.focus();
    });
    this.render();
  }
  private render() {
    const text = this.node.textContent;
    if (text === this.text && this.dom.dataset.ready) return;
    this.text = text;
    if (rawOnly(text)) {
      this.dom.classList.add('literal-raw');
      return;
    }
    flushSync(() =>
      this.root.render(
        <Markdown remarkPlugins={[remarkGfm, remarkLiteral]} components={components}>
          {withoutFootnoteSyntax(text)}
        </Markdown>,
      ),
    );
    // What shows nothing (raw HTML, an empty block) stays as its text.
    this.dom.classList.toggle('literal-raw', !this.preview.textContent?.trim());
    this.dom.dataset.ready = '1';
  }
  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  stopEvent(event: Event) {
    return this.preview.contains(event.target as globalThis.Node);
  }
  ignoreMutation(mutation: { target: globalThis.Node }) {
    return this.preview.contains(mutation.target);
  }
  destroy() {
    const root = this.root;
    // React may be rendering; unmount after it.
    queueMicrotask(() => root.unmount());
  }
}

export const literalView = $view(
  literalBlock,
  () => (node, view, getPos) => new LiteralView(node, view, getPos),
);

/** The literal block holding the cursor shows its text for editing. */
const editingKey = new PluginKey('irori-literal-editing');
export const literalEditing = $prose(
  () =>
    new Plugin({
      key: editingKey,
      props: {
        decorations: (state) => {
          const { $from, $to } = state.selection;
          const found: Decoration[] = [];
          state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (node.type.name !== 'irori_literal') return true;
            found.push(Decoration.node(pos, pos + node.nodeSize, { class: 'literal-editing' }));
            return false;
          });
          return found.length ? DecorationSet.create(state.doc, found) : null;
        },
      },
    }),
);
