import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { t } from '../../domain/i18n';
import type { ViewProps } from './common';
import { followLinks, neutralize } from './safe-dom';

/**
 * A Word document laid out as pages. It renders into a shadow root so the styles the
 * document declares stay inside it, and the page's own styles stay out.
 */
export default function WordView({ bytes, zoom, width, onInfo, onLink }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const root = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });
    const body = document.createElement('div');
    const styles = document.createElement('div');
    const frame = document.createElement('style');
    // The library's grey backdrop gives way to the stage; pages keep their paper.
    frame.textContent = `.docx-wrapper { background: transparent !important; padding: 20px 0 !important; }
      .docx-wrapper > section.docx { box-shadow: 0 0 0 1px rgba(24, 26, 30, 0.08), 0 8px 24px rgba(24, 26, 30, 0.12) !important; }`;
    root.replaceChildren(styles, frame, body);
    let live = true;
    setError('');
    renderAsync(bytes, body, styles, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      useBase64URL: true,
      renderAltChunks: false,
      renderComments: false,
      renderChanges: false,
    }).then(
      () => {
        if (!live) return;
        neutralize(body);
        const pages = body.querySelectorAll('section.docx');
        // The declared width, which the zoom applied to the host does not change.
        setPageWidth(
          Math.max(0, ...[...pages].map((page) => parseFloat(getComputedStyle(page).width) || 0)),
        );
        onInfo(t(`${pages.length} ページ（目安）`, `About ${pages.length} pages`));
      },
      (reason: Error) =>
        live &&
        setError(
          t(
            `Word 文書を読めませんでした: ${reason.message}`,
            `Could not read the Word document: ${reason.message}`,
          ),
        ),
    );
    const stop = followLinks(root, onLink);
    return () => {
      live = false;
      stop();
    };
  }, [bytes]);
  // A page wider than the stage shrinks to fit; a narrower one keeps its printed size.
  const fit = pageWidth ? Math.min(1, (width - 16) / (pageWidth + 60)) : 1;
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div ref={host} className="word-document" style={{ zoom: fit * zoom }} />
    </>
  );
}
