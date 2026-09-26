import { useEffect, useState } from 'react';
import { t } from '../../domain/i18n';
import type { ViewProps } from './common';

const types: [RegExp, string][] = [
  [/\.png$/i, 'image/png'],
  [/\.jpe?g$/i, 'image/jpeg'],
  [/\.gif$/i, 'image/gif'],
  [/\.webp$/i, 'image/webp'],
  [/\.svg$/i, 'image/svg+xml'],
  [/\.bmp$/i, 'image/bmp'],
  [/\.avif$/i, 'image/avif'],
];

/**
 * An image, as a data URL: the CSP admits no other source, and an SVG shown through
 * an <img> runs none of its scripts.
 */
export default function ImageView({
  bytes,
  zoom,
  width,
  path,
  onInfo,
}: ViewProps & { path: string }) {
  const [url, setUrl] = useState('');
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  useEffect(() => {
    const type = types.find(([pattern]) => pattern.test(path))?.[1] ?? 'application/octet-stream';
    const reader = new FileReader();
    reader.onload = () => setUrl(String(reader.result));
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    return () => reader.abort();
  }, [bytes, path]);
  if (!url) return <p className="hint">{t('画像を開いています…', 'Opening the image…')}</p>;
  const fit = natural ? Math.min(1, (width - 48) / natural.width) : 1;
  return (
    <div className="image-view">
      <img
        src={url}
        alt={path.split('/').at(-1)}
        style={natural ? { width: natural.width * fit * zoom } : undefined}
        onLoad={(event) => {
          const image = event.currentTarget;
          setNatural({ width: image.naturalWidth, height: image.naturalHeight });
          onInfo(`${image.naturalWidth} × ${image.naturalHeight}`);
        }}
      />
    </div>
  );
}
