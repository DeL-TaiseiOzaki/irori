import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { findAll } from '../../domain/find';
import { t } from '../../domain/i18n';
import { paintHighlights, reveal, useFinder, viewTop, type Finder } from '../FindBar';
import type { ViewProps } from './common';

GlobalWorkerOptions.workerSrc = workerUrl;

// The page's CSP refuses fetch, so pdf.js cannot load its CMaps (needed for most
// Japanese PDFs), standard fonts or image decoders by URL. They are bundled as
// separate lazy chunks instead and handed over through its binary data factory.
const bundled = {
  cMapUrl: import.meta.glob('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
    query: '?inline',
    import: 'default',
  }),
  standardFontDataUrl: import.meta.glob(
    '../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
    { query: '?inline', import: 'default' },
  ),
  wasmUrl: import.meta.glob('../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', {
    query: '?inline',
    import: 'default',
  }),
};
class BundledData {
  async fetch({ kind, filename }: { kind: keyof typeof bundled; filename: string }) {
    const load = Object.entries(bundled[kind] ?? {}).find(([key]) =>
      key.endsWith(`/${filename}`),
    )?.[1];
    if (!load) throw Error(`pdf.js data is not bundled: ${filename}`);
    const url = String(await load());
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}

/** CSS pixels per PDF point at 100%. */
const cssUnits = 96 / 72;

/** A page's text as pdf.js lays it out in the text layer, and where each of its items starts. */
interface PageText {
  text: string;
  offsets: number[];
}

/**
 * The find bar's occurrences in a PDF. Every page's text is read to count them;
 * they are marked in the text layers drawn now, and a page brought into view to
 * show one marks it once its text layer is drawn.
 */
class PdfMarks {
  private texts?: Promise<PageText[]>;
  private read?: PageText[];
  private matches: { page: number; from: number; to: number }[] = [];
  private current = -1;
  private pending?: number;
  private layers = new Map<number, HTMLElement[]>();
  constructor(
    private pdf: PDFDocumentProxy,
    private pages: () => HTMLElement | null,
  ) {}

  private pageTexts() {
    this.texts ??= Promise.all(
      Array.from({ length: this.pdf.numPages }, async (_, index) => {
        const content = await (await this.pdf.getPage(index + 1)).getTextContent();
        const page: PageText = { text: '', offsets: [] };
        for (const item of content.items) {
          if (!('str' in item)) continue;
          page.offsets.push(page.text.length);
          page.text += item.str + (item.hasEOL ? '\n' : '');
        }
        return page;
      }),
    ).then((texts) => (this.read = texts));
    return this.texts;
  }

  /** The DOM range over an occurrence in a drawn text layer, whose spans are the page's items. */
  private range(match: { page: number; from: number; to: number }) {
    const spans = this.layers.get(match.page);
    const offsets = this.read?.[match.page - 1]?.offsets;
    if (!spans || !offsets) return undefined;
    const point = (offset: number, end: boolean) => {
      const at = end ? offset - 1 : offset;
      let index = offsets.length - 1;
      while (index > 0 && offsets[index] > at) index--;
      const node = spans[index]?.firstChild;
      if (!node) return undefined;
      return { node, offset: Math.min(offset - offsets[index], node.textContent!.length) };
    };
    const from = point(match.from, false);
    const to = point(match.to, true);
    if (!from || !to) return undefined;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  private paint() {
    const ranges: Range[] = [];
    let current: Range | undefined;
    this.matches.forEach((match, index) => {
      const range = this.layers.has(match.page) ? this.range(match) : undefined;
      if (!range) return;
      ranges.push(range);
      if (index === this.current) current = range;
    });
    paintHighlights(ranges, current);
  }

  async find(query: string) {
    const previous = this.matches[this.current];
    const texts = await this.pageTexts();
    this.matches = [];
    if (query)
      texts.forEach((page, index) => {
        for (const at of findAll(page.text, query))
          this.matches.push({ page: index + 1, from: at, to: at + query.length });
      });
    this.current = -1;
    this.pending = undefined;
    this.paint();
    // From the occurrence last shown, or else from the first page in view.
    let from = previous;
    if (!from) {
      const shown = [...(this.pages()?.children ?? [])];
      const top = viewTop(this.pages() ?? undefined);
      const page = shown.findIndex((box) => box.getBoundingClientRect().bottom > top);
      from = { page: page + 1, from: 0, to: 0 };
    }
    const start = this.matches.findIndex(
      (match) => match.page > from.page || (match.page === from.page && match.from >= from.from),
    );
    return { count: this.matches.length, start: Math.max(0, start) };
  }

  show(index: number, scroll: boolean) {
    const match = this.matches[index];
    if (!match) return;
    this.current = index;
    this.pending = undefined;
    this.paint();
    if (!scroll) return;
    const range = this.layers.has(match.page) ? this.range(match) : undefined;
    if (range) reveal(range.startContainer.parentElement);
    else {
      this.pending = index;
      reveal(this.pages()?.children[match.page - 1]);
    }
  }

  clear() {
    this.matches = [];
    this.current = -1;
    this.pending = undefined;
    paintHighlights([]);
  }

  /** A page's text layer is drawn: its occurrences are marked, and one waited for is shown. */
  attach(page: number, spans: HTMLElement[]) {
    this.layers.set(page, spans);
    if (!this.matches.length) return;
    this.paint();
    const waiting = this.pending === undefined ? undefined : this.matches[this.pending];
    if (waiting?.page !== page) return;
    this.pending = undefined;
    reveal(this.range(waiting)?.startContainer.parentElement);
  }

  detach(page: number, spans: HTMLElement[]) {
    if (this.layers.get(page) === spans) this.layers.delete(page);
  }
}

export default function PdfView({ bytes, zoom, width, onInfo }: ViewProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [first, setFirst] = useState<{ width: number; height: number }>();
  const [error, setError] = useState('');
  const pages = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => pdf && new PdfMarks(pdf, () => pages.current), [pdf]);
  const live = useRef(marks);
  live.current = marks;
  const finder = useMemo<Finder>(
    () => ({
      find: async (query) => (await live.current?.find(query)) ?? { count: 0, start: 0 },
      show: (index, scroll) => live.current?.show(index, scroll),
      clear: () => {
        live.current?.clear();
        return false;
      },
    }),
    [],
  );
  const changed = useFinder(finder);
  useEffect(changed, [marks]);
  useEffect(() => () => paintHighlights([]), []);
  useEffect(() => {
    let live = true;
    const task = getDocument({
      // The worker takes ownership of the buffer it is given.
      data: bytes.slice(),
      BinaryDataFactory: BundledData,
      useWorkerFetch: false,
      cMapUrl: 'bundled/',
      standardFontDataUrl: 'bundled/',
      wasmUrl: 'bundled/',
      isEvalSupported: false,
      enableXfa: false,
    } as Parameters<typeof getDocument>[0]);
    task.promise.then(
      async (loaded) => {
        const page = await loaded.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        if (!live) return;
        setFirst({ width: viewport.width, height: viewport.height });
        setPdf(loaded);
        onInfo(t(`${loaded.numPages} ページ`, `${loaded.numPages} pages`));
      },
      (reason: Error) => {
        if (!live) return;
        setError(
          reason.name === 'PasswordException'
            ? t(
                'パスワードで保護された PDF は表示できません。',
                "Can't show password-protected PDFs.",
              )
            : t(
                `PDF を読めませんでした: ${reason.message}`,
                `Could not read the PDF: ${reason.message}`,
              ),
        );
      },
    );
    return () => {
      live = false;
      void task.destroy();
    };
  }, [bytes]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!pdf || !first) return <p className="hint">{t('PDF を開いています…', 'Opening the PDF…')}</p>;
  // Fit the first page's width, but never past 150% on a wide stage.
  const fit = Math.min((width - 48) / first.width, 1.5 * cssUnits);
  const scale = Math.max(0.1, fit * zoom);
  return (
    <div ref={pages} className="pdf-pages">
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPage
          key={index}
          pdf={pdf}
          number={index + 1}
          scale={scale}
          guess={first}
          marks={marks}
        />
      ))}
    </div>
  );
}

function PdfPage({
  pdf,
  number,
  scale,
  guess,
  marks,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  scale: number;
  guess: { width: number; height: number };
  marks?: PdfMarks;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [page, setPage] = useState<PDFPageProxy>();
  const size = page ? page.getViewport({ scale: 1 }) : guess;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: '1200px 0px',
    });
    observer.observe(box.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near || page) return;
    let live = true;
    void pdf.getPage(number).then((loaded) => live && setPage(loaded));
    return () => {
      live = false;
    };
  }, [near, page, pdf, number]);
  useEffect(() => {
    const host = box.current!;
    if (!near || !page) return;
    const viewport = page.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const text = document.createElement('div');
    text.className = 'textLayer';
    let render: RenderTask | undefined;
    let layer: TextLayer | undefined;
    let spans: HTMLElement[] | undefined;
    let live = true;
    render = page.render({
      canvas,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    render.promise.then(
      async () => {
        if (!live) return;
        host.replaceChildren(canvas, text);
        layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: text,
          viewport,
        });
        await layer.render().catch(() => {});
        if (!live) return;
        spans = layer.textDivs;
        marks?.attach(number, spans);
      },
      (reason) => {
        if (!(reason instanceof RenderingCancelledException) && live)
          host.textContent = t(
            'このページを描画できませんでした。',
            'This page could not be drawn.',
          );
      },
    );
    return () => {
      live = false;
      render?.cancel();
      layer?.cancel();
      if (spans) marks?.detach(number, spans);
    };
  }, [near, page, scale, marks]);
  return (
    <div
      ref={box}
      className="pdf-page"
      aria-label={t(`${number} ページ`, `Page ${number}`)}
      style={
        {
          width: size.width * scale,
          height: size.height * scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as React.CSSProperties
      }
    />
  );
}
