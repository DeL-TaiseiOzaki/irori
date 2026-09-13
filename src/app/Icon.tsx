import type { CSSProperties } from 'react';

const paths = {
  chevron: 'm9 5 7 7-7 7',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h5',
  cloud: 'M7 18a5 5 0 1 1 1-9.9A7 7 0 0 1 21 11a4 4 0 0 1-1 7H7Z',
  book: 'M12 5C8 2 4 3 2 4v16c3-2 7-1 10 1m0-16c4-3 8-2 10-1v16c-3-2-7-1-10 1V5Z',
  schema: 'm8 4-6 8 6 8m8-16 6 8-6 8m-3-17-2 18',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-3l2 3M4 17l2 3a8 8 0 0 0 13-3',
  sparkles: 'm12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3ZM20 2v4m-2-2h4',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  grid: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
} as const;

export function Icon({
  name,
  size = 16,
  className = '',
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
