import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { Document } from '../domain/types';
import type { ViewerKind } from '../domain/viewers';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import type { ViewProps } from './viewers/common';
import './viewers.css';

// Each format's library loads only when a file of that format is opened.
const views: Record<ViewerKind, ComponentType<ViewProps & { path: string }>> = {
  pdf: lazy(() => import('./viewers/PdfView')),
  word: lazy(() => import('./viewers/WordView')),
  slides: lazy(() => import('./viewers/SlidesView')),
  sheet: lazy(() => import('./viewers/SheetView')),
  image: lazy(() => import('./viewers/ImageView')),
};
export const viewerLabel = (kind: ViewerKind) =>
  ({
    pdf: 'PDF',
    word: 'Word',
    slides: 'PowerPoint',
    sheet: t('スプレッドシート', 'Spreadsheet'),
    image: t('画像', 'Image'),
  })[kind];

const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/**
 * Shows a file irori does not edit — PDF, Word, PowerPoint, a spreadsheet or an image —
 * in place of the editor. The file's bytes come from the host; the format's library
 * runs here, in the sandboxed renderer, and nothing is written back.
 */
export function FileViewer({
  doc,
  load,
  onExternal,
  onLink,
}: {
  doc: Document & { viewer: ViewerKind };
  load(scopeId: string, path: string): Promise<Uint8Array>;
  onExternal(): void;
  onLink(url: string): void;
}) {
  const [bytes, setBytes] = useState<Uint8Array>();
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setBytes(undefined);
    setError('');
    setInfo('');
    load(doc.scopeId, doc.path).then(
      (loaded) => live && setBytes(loaded),
      (reason: Error) => live && setError(reason.message),
    );
    return () => {
      live = false;
    };
    // The version changes when the file does, and the view reads it again.
  }, [doc.scopeId, doc.path, doc.hash]);
  useEffect(() => {
    const element = body.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const View = views[doc.viewer];
  const step = (direction: 1 | -1) =>
    setZoom(
      (current) =>
        (direction > 0
          ? steps.find((value) => value > current + 0.001)
          : [...steps].reverse().find((value) => value < current - 0.001)) ?? current,
    );
  const failure = (message: string) => (
    <div className="viewer-failure" role="alert">
      <p>{message}</p>
      <button onClick={onExternal}>
        <Icon name="arrow" size={14} />
        {t('外部アプリで開く', 'Open in an external app')}
      </button>
    </div>
  );
  return (
    <section
      className="file-viewer"
      aria-label={t(`${viewerLabel(doc.viewer)} ビューアー`, `${viewerLabel(doc.viewer)} viewer`)}
    >
      <div className="viewer-bar">
        <span className="viewer-kind">{viewerLabel(doc.viewer)}</span>
        <span className="viewer-info" role="status">
          {info}
        </span>
        <span className="viewer-zoom">
          <button
            className="icon-button"
            aria-label={t('縮小', 'Zoom out')}
            disabled={zoom <= steps[0]}
            onClick={() => step(-1)}
          >
            <Icon name="minus" size={14} />
          </button>
          <button
            className="zoom-level"
            title={t('幅に合わせる', 'Fit to width')}
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-button"
            aria-label={t('拡大', 'Zoom in')}
            disabled={zoom >= steps.at(-1)!}
            onClick={() => step(1)}
          >
            <Icon name="plus" size={14} />
          </button>
        </span>
        <button className="viewer-external" onClick={onExternal}>
          {t('外部アプリで開く', 'Open in an external app')}
        </button>
      </div>
      <div ref={body} className={`viewer-body viewer-${doc.viewer}`}>
        {error ? (
          failure(error)
        ) : !bytes ? (
          <p className="hint">{t('ファイルを読み込んでいます…', 'Reading the file…')}</p>
        ) : (
          width > 0 && (
            <ErrorBoundary
              resetKeys={[bytes]}
              fallbackRender={({ error: thrown }) =>
                failure(
                  t(
                    `このファイルを表示できませんでした: ${String((thrown as Error)?.message ?? thrown)}`,
                    `This file could not be shown: ${String((thrown as Error)?.message ?? thrown)}`,
                  ),
                )
              }
            >
              <Suspense
                fallback={
                  <p className="hint">
                    {t('ビューアーを準備しています…', 'Preparing the viewer…')}
                  </p>
                }
              >
                <View
                  bytes={bytes}
                  zoom={zoom}
                  width={width}
                  path={doc.path}
                  onInfo={setInfo}
                  onLink={onLink}
                />
              </Suspense>
            </ErrorBoundary>
          )
        )}
      </div>
    </section>
  );
}
