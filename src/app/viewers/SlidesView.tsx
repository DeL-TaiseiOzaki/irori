import { useEffect, useRef, useState } from 'react';
import { pptxToHtml } from '@jvmr/pptx-to-html';
import { t } from '../../domain/i18n';
import type { ViewProps } from './common';
import { followLinks, safeFragment } from './safe-dom';

/**
 * A PowerPoint deck as a column of slides. The converter lays each slide out at the
 * deck's own size; the view scales it to the stage, inside a shadow root.
 */
export default function SlidesView({ bytes, zoom, width, onInfo, onLink }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [slides, setSlides] = useState<{ html: string; width: number; height: number }[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setSlides(undefined);
    setError('');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    pptxToHtml(buffer as ArrayBuffer, { scaleToFit: true, letterbox: true }).then(
      (html) => {
        if (!live) return;
        setSlides(
          html.map((markup) => {
            // The deck's size is the inner slide's; the letterbox around it is discarded.
            const size = /class="slide" style="[^"]*?width: ([\d.]+)px; height: ([\d.]+)px/.exec(
              markup,
            );
            return {
              html: markup,
              width: Number(size?.[1]) || 960,
              height: Number(size?.[2]) || 540,
            };
          }),
        );
        onInfo(t(`${html.length} 枚のスライド`, `${html.length} slides`));
      },
      (reason: Error) =>
        live &&
        setError(
          t(
            `PowerPoint を読めませんでした: ${reason.message}`,
            `Could not read the PowerPoint file: ${reason.message}`,
          ),
        ),
    );
    return () => {
      live = false;
    };
  }, [bytes]);
  useEffect(() => {
    if (!slides) return;
    const root = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host { display: block; }
      .deck { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 20px 0; }
      .frame { position: relative; overflow: hidden; background: #fff;
        box-shadow: 0 0 0 1px rgba(24, 26, 30, 0.08), 0 8px 24px rgba(24, 26, 30, 0.12); }
      .frame > .slide { position: absolute !important; left: 0 !important; top: 0 !important;
        transform-origin: top left !important; overflow: hidden; }
      .number { font: 12px/1 system-ui, sans-serif; color: #646a73; margin-top: -12px; }`;
    const deck = document.createElement('div');
    deck.className = 'deck';
    for (const [index, slide] of slides.entries()) {
      const frame = document.createElement('section');
      frame.className = 'frame';
      frame.setAttribute('aria-label', t(`スライド ${index + 1}`, `Slide ${index + 1}`));
      const inner = safeFragment(slide.html).querySelector<HTMLElement>('.slide');
      if (inner) frame.append(inner);
      const number = document.createElement('div');
      number.className = 'number';
      number.textContent = `${index + 1} / ${slides.length}`;
      deck.append(frame, number);
    }
    root.replaceChildren(style, deck);
    return followLinks(root, onLink);
  }, [slides]);
  useEffect(() => {
    const root = host.current?.shadowRoot;
    if (!slides || !root) return;
    const frames = root.querySelectorAll<HTMLElement>('.frame');
    for (const [index, frame] of [...frames].entries()) {
      const { width: base, height } = slides[index];
      // Fit the stage, but never past 1.5× the deck's own size on a wide one.
      const scale = Math.max(0.1, Math.min((width - 48) / base, 1.5) * zoom);
      frame.style.width = `${base * scale}px`;
      frame.style.height = `${height * scale}px`;
      const inner = frame.querySelector<HTMLElement>('.slide');
      if (inner) inner.style.setProperty('transform', `scale(${scale})`, 'important');
    }
  }, [slides, zoom, width]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  return (
    <>
      {!slides && <p className="hint">{t('スライドを開いています…', 'Opening the slides…')}</p>}
      <div ref={host} className="slide-deck" />
    </>
  );
}
