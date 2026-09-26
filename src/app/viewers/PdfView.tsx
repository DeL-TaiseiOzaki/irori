import { useEffect, useRef, useState } from 'react';
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
import { t } from '../../domain/i18n';
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

export default function PdfView({ bytes, zoom, width, onInfo }: ViewProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [first, setFirst] = useState<{ width: number; height: number }>();
  const [error, setError] = useState('');
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
                'パスワードで保護された PDF は外部アプリで開いてください。',
                'Open password-protected PDFs in an external app.',
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
    <div className="pdf-pages">
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPage key={index} pdf={pdf} number={index + 1} scale={scale} guess={first} />
      ))}
    </div>
  );
}

function PdfPage({
  pdf,
  number,
  scale,
  guess,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  scale: number;
  guess: { width: number; height: number };
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
    };
  }, [near, page, scale]);
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
