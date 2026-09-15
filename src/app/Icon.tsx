import type { CSSProperties } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  GitBranch,
  LayoutGrid,
  Network,
  Plus,
  RefreshCw,
  RotateCcwClock,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';

// The application names icons by role. Lucide supplies the drawings, so a new
// icon is a named import here instead of another hand-written path.
const icons = {
  terminal: Terminal,
  branch: GitBranch,
  history: RotateCcwClock,
  chevron: ChevronRight,
  folder: Folder,
  file: FileText,
  cloud: Cloud,
  book: BookOpen,
  schema: Network,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  sparkles: Sparkles,
  close: X,
  arrow: ArrowRight,
  check: Check,
  grid: LayoutGrid,
} as const;

export function Icon({
  name,
  size = 16,
  className = '',
  style,
}: {
  name: keyof typeof icons;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Glyph = icons[name];
  return (
    <Glyph
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      strokeWidth={1.6}
      aria-hidden="true"
      focusable="false"
      style={style}
    />
  );
}
