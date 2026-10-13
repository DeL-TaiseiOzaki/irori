import JSZip from 'jszip';

/**
 * Makes a deck say outright what PowerPoint works out, before `pptx-to-html`
 * reads it. That converter reads each slide shape on its own: text without a
 * size becomes 44 pt bold in a title and 18 pt elsewhere, a placeholder without
 * a position takes the layout's or none, insets default to nothing, and the
 * first `solidFill` anywhere in a shape's properties is its fill, so an outline
 * fills a shape that has none. Here each slide placeholder takes, from its
 * layout and master, what it leaves out: position, anchor, insets, and each
 * level's size, weight, colour, font and alignment. Every shape gets a fill the
 * converter reads as PowerPoint does. Only the copy the viewer draws changes.
 */

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

export interface XmlTools {
  parse: (text: string) => Document;
  serialize: (doc: Document) => string;
}

const browserTools = (): XmlTools => ({
  parse: (text) => new DOMParser().parseFromString(text, 'application/xml'),
  serialize: (doc) => new XMLSerializer().serializeToString(doc),
});

const elements = (node: Node | null | undefined): Element[] =>
  node
    ? [...(node.childNodes as unknown as Iterable<Node>)].filter(
        (c): c is Element => c.nodeType === 1,
      )
    : [];
const kids = (el: Element | null | undefined, ns: string, name: string) =>
  elements(el).filter((c) => c.namespaceURI === ns && c.localName === name);
const kid = (el: Element | null | undefined, ns: string, name: string) =>
  kids(el, ns, name)[0] as Element | undefined;
/** Every element of that name below `root`, at any depth (group shapes nest). */
function descendants(root: Element, ns: string, name: string): Element[] {
  const found: Element[] = [];
  const walk = (el: Element) => {
    for (const child of elements(el)) {
      if (child.namespaceURI === ns && child.localName === name) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** A part path from a relationship target, relative to the part's folder. */
function resolve(from: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}
const relsOf = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');

interface Placeholder {
  type: string;
  idx?: string;
  sp: Element;
}
const placeholderOf = (sp: Element): Placeholder | undefined => {
  const ph = kid(kid(kid(sp, P, 'nvSpPr'), P, 'nvPr'), P, 'ph');
  if (!ph) return undefined;
  return { type: ph.getAttribute('type') || 'obj', idx: ph.getAttribute('idx') ?? undefined, sp };
};
const titleType = (type: string) => (type === 'ctrTitle' ? 'title' : type);
/** The master placeholder a type falls back to: titles to the title, text to the body. */
const masterType = (type: string) =>
  ['title', 'ctrTitle'].includes(type)
    ? 'title'
    : ['dt', 'ftr', 'sldNum', 'hdr'].includes(type)
      ? type
      : 'body';
/** The master text style a placeholder starts from. */
const styleName = (type: string) =>
  ['title', 'ctrTitle'].includes(type)
    ? 'titleStyle'
    : ['body', 'subTitle', 'obj'].includes(type)
      ? 'bodyStyle'
      : 'otherStyle';

function matchLayout(ph: Placeholder, layout: Placeholder[]) {
  return (
    (ph.idx !== undefined ? layout.find((item) => item.idx === ph.idx) : undefined) ??
    layout.find((item) => titleType(item.type) === titleType(ph.type))
  );
}

/** What one list level says about its text. */
interface Level {
  sz?: string;
  b?: string;
  algn?: string;
  fill?: Element;
  latin?: string;
}
const levelCount = 9;
/** Each level of a `lstStyle` or master text style, laid over `base`. */
function levels(style: Element | undefined, base: Level[]): Level[] {
  return base.map((level, index) => {
    const pPr = kid(style, A, `lvl${index + 1}pPr`);
    if (!pPr) return level;
    const rPr = kid(pPr, A, 'defRPr');
    const fill = kid(rPr, A, 'solidFill');
    return {
      sz: rPr?.getAttribute('sz') || level.sz,
      b: rPr?.getAttribute('b') || level.b,
      algn: pPr.getAttribute('algn') || level.algn,
      fill: fill ?? level.fill,
      latin: kid(rPr, A, 'latin')?.getAttribute('typeface') || level.latin,
    };
  });
}

const insetDefaults: Record<string, string> = {
  lIns: '91440',
  tIns: '45720',
  rIns: '91440',
  bIns: '45720',
  anchor: 't',
};

/** The theme's heading and body typefaces, for `+mj-lt` and `+mn-lt`. */
function themeFonts(theme: Document | undefined) {
  const scheme = theme ? descendants(theme.documentElement, A, 'fontScheme')[0] : undefined;
  const face = (which: string) => {
    const font = kid(scheme, A, which);
    return (
      kid(font, A, 'latin')?.getAttribute('typeface') ||
      kid(font, A, 'ea')?.getAttribute('typeface') ||
      undefined
    );
  };
  return { '+mj-lt': face('majorFont'), '+mn-lt': face('minorFont') } as Record<
    string,
    string | undefined
  >;
}

/**
 * A fill the converter reads as PowerPoint draws it. `iroriNone` names no theme
 * colour, so the converter finds no colour and goes on to the shape's style.
 */
function fixFill(sp: Element) {
  const spPr = kid(sp, P, 'spPr');
  if (!spPr) return;
  const doc = sp.ownerDocument;
  const fills = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
  const direct = elements(spPr).find((c) => c.namespaceURI === A && fills.includes(c.localName));
  if (direct?.localName === 'solidFill') return;
  const solid = doc.createElementNS(A, 'a:solidFill');
  const colour =
    direct?.localName === 'gradFill'
      ? elements(descendants(direct, A, 'gs')[0])[0]
      : direct?.localName === 'pattFill'
        ? elements(kid(direct, A, 'fgClr'))[0]
        : undefined;
  if (colour) solid.appendChild(colour.cloneNode(true));
  else {
    const none = doc.createElementNS(A, 'a:schemeClr');
    none.setAttribute('val', 'iroriNone');
    solid.appendChild(none);
    // An explicit "no fill" also overrides the style's fill.
    if (direct) for (const ref of descendants(sp, A, 'fillRef')) ref.parentNode?.removeChild(ref);
  }
  if (direct) spPr.replaceChild(solid, direct);
  else spPr.insertBefore(solid, spPr.firstChild);
}

interface Inherited {
  master?: Document;
  layout?: Document;
  fonts: Record<string, string | undefined>;
}

/** One slide's placeholders and text shapes, told what they inherit. */
function normalizeSlide(slide: Document, from: Inherited) {
  const placeholders = (doc?: Document) =>
    doc ? descendants(doc.documentElement, P, 'sp').flatMap((sp) => placeholderOf(sp) ?? []) : [];
  const layoutPhs = placeholders(from.layout);
  const masterPhs = placeholders(from.master);
  const txStyles = from.master
    ? descendants(from.master.documentElement, P, 'txStyles')[0]
    : undefined;
  for (const sp of descendants(slide.documentElement, P, 'sp')) {
    fixFill(sp);
    const ph = placeholderOf(sp);
    const layoutPh = ph ? matchLayout(ph, layoutPhs)?.sp : undefined;
    const type = ph ? (layoutPh && placeholderOf(layoutPh)?.type) || ph.type : undefined;
    const masterPh = type
      ? masterPhs.find((item) => titleType(item.type) === masterType(type))?.sp
      : undefined;
    const chain = [masterPh, layoutPh].filter((item): item is Element => !!item);
    // Where it is: its own position, or the layout's, or the master's.
    const spPr = kid(sp, P, 'spPr');
    if (ph && spPr && !kid(spPr, A, 'xfrm')) {
      const xfrm = [...chain]
        .reverse()
        .map((item) => kid(kid(item, P, 'spPr'), A, 'xfrm'))
        .find(Boolean);
      if (xfrm) spPr.insertBefore(slide.importNode(xfrm, true), spPr.firstChild);
    }
    const txBody = kid(sp, P, 'txBody');
    if (!txBody) continue;
    let bodyPr = kid(txBody, A, 'bodyPr');
    if (!bodyPr) {
      bodyPr = slide.createElementNS(A, 'a:bodyPr');
      txBody.insertBefore(bodyPr, txBody.firstChild);
    }
    for (const name of Object.keys(insetDefaults)) {
      if (bodyPr.hasAttribute(name)) continue;
      const inherited = [...chain]
        .reverse()
        .map((item) => kid(kid(item, P, 'txBody'), A, 'bodyPr')?.getAttribute(name))
        .find((value) => !!value);
      bodyPr.setAttribute(name, inherited || insetDefaults[name]);
    }
    const scale =
      Number(kid(bodyPr, A, 'normAutofit')?.getAttribute('fontScale') ?? 100000) / 100000 || 1;
    let style: Level[] = Array.from({ length: levelCount }, () => ({}));
    if (ph && type) style = levels(kid(txStyles, P, styleName(type)), style);
    for (const item of chain) style = levels(kid(kid(item, P, 'txBody'), A, 'lstStyle'), style);
    style = levels(kid(txBody, A, 'lstStyle'), style);
    for (const p of kids(txBody, A, 'p')) {
      let pPr = kid(p, A, 'pPr');
      const level = style[Math.min(Number(pPr?.getAttribute('lvl') ?? 0) || 0, levelCount - 1)];
      if (level.algn && !pPr?.hasAttribute('algn')) {
        if (!pPr) {
          pPr = slide.createElementNS(A, 'a:pPr');
          p.insertBefore(pPr, p.firstChild);
        }
        pPr.setAttribute('algn', level.algn);
      }
      for (const run of [...kids(p, A, 'r'), ...kids(p, A, 'fld')]) {
        let rPr = kid(run, A, 'rPr');
        if (!rPr) {
          rPr = slide.createElementNS(A, 'a:rPr');
          run.insertBefore(rPr, run.firstChild);
        }
        const size = rPr.getAttribute('sz') || level.sz;
        if (size) rPr.setAttribute('sz', String(Math.round(Number(size) * scale)));
        if (!rPr.hasAttribute('b') && level.b) rPr.setAttribute('b', level.b);
        if (!kid(rPr, A, 'solidFill') && level.fill)
          rPr.insertBefore(slide.importNode(level.fill, true), rPr.firstChild);
        let latin = kid(rPr, A, 'latin');
        if (!latin && level.latin) {
          latin = slide.createElementNS(A, 'a:latin');
          latin.setAttribute('typeface', level.latin);
          rPr.appendChild(latin);
        }
        const face = latin?.getAttribute('typeface');
        if (latin && face && face.startsWith('+')) {
          const named = from.fonts[face];
          if (named) latin.setAttribute('typeface', named);
          else latin.parentNode?.removeChild(latin);
        }
      }
    }
  }
}

/** The deck with what each slide inherits written out, as the converter needs it. */
export async function normalizeDeck(
  buffer: ArrayBuffer,
  tools: XmlTools = browserTools(),
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (part: string) => {
    const file = zip.file(part);
    return file ? tools.parse(await file.async('string')) : undefined;
  };
  const target = async (part: string, type: string) => {
    const rels = await read(relsOf(part));
    const rel = rels
      ? [...(rels.getElementsByTagName('Relationship') as unknown as Iterable<Element>)].find(
          (item) => (item.getAttribute('Type') ?? '').endsWith(`/${type}`),
        )
      : undefined;
    const to = rel?.getAttribute('Target');
    return to ? resolve(part, to) : undefined;
  };
  const cache = new Map<string, Promise<Document | undefined>>();
  const cached = (part: string) => {
    if (!cache.has(part)) cache.set(part, read(part));
    return cache.get(part)!;
  };
  const touched = new Set<string>();
  // The layouts' and masters' own shapes are drawn on every slide, so their fills are mended too.
  const fixShapes = async (part: string) => {
    const doc = await cached(part);
    if (!doc || touched.has(part)) return;
    touched.add(part);
    for (const sp of descendants(doc.documentElement, P, 'sp')) fixFill(sp);
  };
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  for (const part of slides) {
    const slide = await read(part);
    if (!slide) continue;
    const layoutPart = await target(part, 'slideLayout');
    const masterPart = layoutPart ? await target(layoutPart, 'slideMaster') : undefined;
    const themePart = masterPart ? await target(masterPart, 'theme') : undefined;
    // Placeholders are matched against the parts as written, before their fills change.
    const layout = layoutPart ? await cached(layoutPart) : undefined;
    const master = masterPart ? await cached(masterPart) : undefined;
    normalizeSlide(slide, {
      layout,
      master,
      fonts: themeFonts(themePart ? await cached(themePart) : undefined),
    });
    zip.file(part, tools.serialize(slide));
    if (layoutPart) await fixShapes(layoutPart);
    if (masterPart) await fixShapes(masterPart);
  }
  for (const part of touched) {
    const doc = await cached(part);
    if (doc) zip.file(part, tools.serialize(doc));
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}
