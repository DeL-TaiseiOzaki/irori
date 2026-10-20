import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import type { Fragment, Node } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose, $view } from '@milkdown/kit/utils';
import { inlinePiece, pieceClass } from './preservation';
import { readPiece, wikiLink } from './pieces';

/*
 * A note's images as Obsidian keeps them: a pasted or dropped image is saved in
 * `_assets/` beside the note and shown where it was added, and an embed
 * `![[name.png]]` shows the image it names.
 */

/** What an image embed's alias sets: a width, or a width and a height. */
const embedSize = /^(\d+)(?:x(\d+))?$/;
const imageFile = /\.(?:png|jpe?g|gif|webp)$/i;

/**
 * Milkdown's image block keeps its size in the image's alt text (`![1.00](…)`),
 * so a note's own alt text was lost on its first edit. A number there is still
 * the size irori wrote; any other alt text is kept as written, and an image at
 * its own size writes none.
 */
export const imageAlt = imageBlockSchema.extendSchema((previous) => (ctx) => {
  const schema = previous(ctx);
  return {
    ...schema,
    attrs: { ...schema.attrs, alt: { default: '', validate: 'string' } },
    parseMarkdown: {
      match: schema.parseMarkdown.match,
      runner: (state, node, type) => {
        const alt = String(node.alt ?? '');
        const size = Number(alt);
        const sized = alt.trim() !== '' && Number.isFinite(size) && size > 0;
        state.addNode(type, {
          src: node.url,
          caption: node.title ?? '',
          ratio: sized ? size : 1,
          alt: sized ? '' : alt,
        });
      },
    },
    toMarkdown: {
      match: schema.toMarkdown.match,
      runner: (state, node) => {
        const ratio = Number.parseFloat(node.attrs.ratio);
        state.openNode('paragraph');
        state.addNode('image', undefined, undefined, {
          title: node.attrs.caption,
          url: node.attrs.src,
          alt: node.attrs.alt || (ratio > 0 && ratio !== 1 ? ratio.toFixed(2) : ''),
        });
        state.closeNode();
      },
    },
  };
});

/**
 * The places an embed `![[name]]` may name, nearest first: beside the note, then
 * in its `_assets/`, where irori keeps the images added to it.
 */
export function embedCandidates(target: string) {
  const url = target.split('/').map(encodeURIComponent).join('/');
  return target.includes('/') ? [url] : [url, `_assets/${url}`];
}

/** An image embed shows its image; any other piece shows its label. */
export function embedView(resolve: () => ((url: string) => Promise<string>) | undefined) {
  return $view(inlinePiece, () => (node) => {
    const value = String(node.attrs.value);
    const { kind, label } = readPiece(value);
    const dom = document.createElement('span');
    dom.dataset.iroriInline = value;
    dom.title = value;
    const [, , target = '', , alias = ''] = new RegExp(`^${wikiLink.source}$`).exec(value) ?? [];
    if (kind !== 'embed' || !imageFile.test(target)) {
      dom.className = pieceClass[kind];
      dom.textContent = label;
      return { dom };
    }
    dom.className = 'wiki-embed-image';
    const image = document.createElement('img');
    image.alt = target;
    const size = embedSize.exec(alias);
    if (size) {
      image.style.width = `${size[1]}px`;
      if (size[2]) image.style.height = `${size[2]}px`;
    }
    dom.append(image);
    void (async () => {
      for (const url of embedCandidates(target)) {
        const src = await resolve()?.(url).catch(() => '');
        if (src) {
          image.src = src;
          return;
        }
      }
      // An image that is not there shows the embed as the text it is.
      dom.className = `${pieceClass.embed} missing`;
      dom.textContent = label;
    })();
    return { dom, ignoreMutation: () => true };
  });
}

const imageBlockName = 'image-block';
/** Whether a step put an image block into the document. */
function addsImage(fragment: Fragment | undefined) {
  let found = false;
  fragment?.descendants((node) => {
    if (node.type.name === imageBlockName) found = true;
    return !found;
  });
  return found;
}
/** How many image blocks show each source. */
function imagesBySource(doc: Node) {
  const count = new Map<string, number>();
  doc.descendants((node) => {
    if (node.type.name !== imageBlockName) return true;
    count.set(node.attrs.src, (count.get(node.attrs.src) ?? 0) + 1);
    return false;
  });
  return count;
}

/**
 * An image pasted or dropped on an empty line takes that line. Milkdown inserts
 * it beside the empty paragraph, which a note would keep as `<br />`.
 */
export const imageOnEmptyLine = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, before, after) => {
        const added = transactions.some((tr) =>
          tr.steps.some((step) =>
            addsImage((step as { slice?: { content: Fragment } }).slice?.content),
          ),
        );
        if (!added) return null;
        const earlier = imagesBySource(before.doc);
        const empty: { from: number; to: number }[] = [];
        after.doc.descendants((node, pos, parent, index) => {
          if (node.type.name !== imageBlockName) return true;
          const left = earlier.get(node.attrs.src) ?? 0;
          if (left > 0) {
            earlier.set(node.attrs.src, left - 1);
            return false;
          }
          const blank = (sibling: Node | null | undefined) =>
            !!sibling && sibling.type.name === 'paragraph' && sibling.content.size === 0;
          const previous = index > 0 ? parent?.child(index - 1) : undefined;
          const next =
            parent && index + 1 < parent.childCount ? parent.child(index + 1) : undefined;
          if (blank(previous)) empty.push({ from: pos - previous!.nodeSize, to: pos });
          else if (blank(next))
            empty.push({ from: pos + node.nodeSize, to: pos + node.nodeSize + next!.nodeSize });
          return false;
        });
        if (!empty.length) return null;
        const tr = after.tr;
        for (const range of empty.reverse()) tr.delete(range.from, range.to);
        return tr;
      },
    }),
);
